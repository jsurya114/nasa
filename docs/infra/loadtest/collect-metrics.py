#!/usr/bin/env python3
"""Evidence for one load-test stage: CloudWatch (EC2 + RDS, 1-minute) and the backend's own sampler, for a time window.

  python3 collect-metrics.py --profile nasa-staging --instance i-... --db nasa-staging-loadtest-db \
      --start 2026-11-20T09:00:00Z --end 2026-11-20T09:12:00Z --sampler sampler.csv --out stage.json

Read-only: CloudWatch GetMetricStatistics only. The sampler CSV is copied off the instance separately.
"""
import argparse, csv, datetime as dt, json, subprocess, statistics


def cw(profile, ns, metric, dims, start, end, stat, period=60):
    cmd = ["aws", "cloudwatch", "get-metric-statistics", "--profile", profile, "--region", "us-east-1", "--namespace", ns,
           "--metric-name", metric, "--start-time", start, "--end-time", end, "--period", str(period), "--statistics", stat, "--output", "json",
           "--dimensions", *[f"Name={k},Value={v}" for k, v in dims.items()]]
    out = subprocess.run(cmd, capture_output=True, text=True, check=True)
    return [p[stat] for p in sorted(json.loads(out.stdout)["Datapoints"], key=lambda p: p["Timestamp"])]


def summary(values, scale=1.0):
    if not values:
        return None
    v = [x / scale for x in values]
    return {"n": len(v), "min": round(min(v), 2), "avg": round(statistics.fmean(v), 2), "max": round(max(v), 2), "last": round(v[-1], 2)}


def sampler(path, start, end):
    if not path:
        return None
    rows = []
    with open(path) as f:
        for r in csv.DictReader(f):
            if r.get("time", "") and start <= r["time"] <= end:
                rows.append(r)
    if not rows:
        return {"n": 0}
    col = lambda k: [float(r[k]) for r in rows if r.get(k) not in (None, "")]
    return {"n": len(rows), "mem_available_mb": summary(col("mem_available_mb")), "swap_used_mb": summary(col("swap_used_mb")),
            "node_rss_mb": summary(col("node_rss_mb")), "node_cpu_pct": summary(col("node_cpu_pct")), "load1": summary(col("load1"))}


def main():
    a = argparse.ArgumentParser()
    for k in ["profile", "instance", "db", "start", "end", "out"]:
        a.add_argument("--" + k, required=True)
    a.add_argument("--sampler")
    args = a.parse_args()
    ec2, rds = {"InstanceId": args.instance}, {"DBInstanceIdentifier": args.db}
    q = lambda ns, m, d, s, scale=1.0: summary(cw(args.profile, ns, m, d, args.start, args.end, s), scale)
    result = {
        "window": {"start": args.start, "end": args.end},
        "ec2": {
            "cpu_avg_pct": q("AWS/EC2", "CPUUtilization", ec2, "Average"),
            "cpu_max_pct": q("AWS/EC2", "CPUUtilization", ec2, "Maximum"),
            "credit_balance": q("AWS/EC2", "CPUCreditBalance", ec2, "Minimum"),
            "credit_usage": q("AWS/EC2", "CPUCreditUsage", ec2, "Sum"),
            "surplus_balance": q("AWS/EC2", "CPUSurplusCreditBalance", ec2, "Maximum"),
            "surplus_charged": q("AWS/EC2", "CPUSurplusCreditsCharged", ec2, "Sum"),
            "network_out_mb": q("AWS/EC2", "NetworkOut", ec2, "Sum", 1e6),
        },
        "rds": {
            "cpu_avg_pct": q("AWS/RDS", "CPUUtilization", rds, "Average"),
            "cpu_max_pct": q("AWS/RDS", "CPUUtilization", rds, "Maximum"),
            "freeable_memory_mb": q("AWS/RDS", "FreeableMemory", rds, "Minimum", 1048576),
            "swap_mb": q("AWS/RDS", "SwapUsage", rds, "Maximum", 1048576),
            "connections_max": q("AWS/RDS", "DatabaseConnections", rds, "Maximum"),
            "read_latency_ms": q("AWS/RDS", "ReadLatency", rds, "Maximum", 0.001),
            "write_latency_ms": q("AWS/RDS", "WriteLatency", rds, "Maximum", 0.001),
            "read_iops": q("AWS/RDS", "ReadIOPS", rds, "Maximum"),
            "credit_balance": q("AWS/RDS", "CPUCreditBalance", rds, "Minimum"),
        },
        "backend_sampler": sampler(args.sampler, args.start, args.end),
    }
    with open(args.out, "w") as f:
        json.dump(result, f, indent=2)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
