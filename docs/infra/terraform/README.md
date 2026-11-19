# NASA AWS infrastructure (Terraform)

Plan and reasoning: [`docs/infra/AWS_NETWORK_PLAN.md`](../AWS_NETWORK_PLAN.md). Costs and the database: [`docs/infra/AWS_COST_OPTIMISATION.md`](../AWS_COST_OPTIMISATION.md). Load test: [`docs/infra/loadtest/`](../../docs/infra/loadtest/README.md).

**Status: validated, never applied.** `terraform validate` passes and `terraform test` (three plans of both modes on a mocked AWS provider) passes. Nothing here has run against a real AWS account, and the instance bootstrap (`user_data.sh.tpl`) has never booted.

## What it creates

VPC (public, app, data subnets in 2 AZs), route tables, network ACLs, security groups, S3 endpoint, optional NAT and flow logs; ALB, target group, listeners and certificate (**off** by default); launch template, Auto Scaling group (1 instance, `max 1`) and CPU scaling policy; instance role (SSM, no SSH); encrypted release bucket; alarms, SNS alerts and a monthly budget.

## First apply (in a NASA AWS account, never the default VPC)

```bash
# 0. Credentials for the NASA account (the local profile on this machine belongs to another project)
aws login                                  # or your SSO profile; export AWS_PROFILE=<nasa profile>

# 1. State bucket, once
cd docs/infra/terraform/bootstrap && terraform init && terraform apply

# 2. Main stack
cd .. && cp backend.hcl.example backend.hcl && cp terraform.tfvars.example terraform.tfvars   # edit both
terraform init -backend-config=backend.hcl
terraform plan -out nasa.tfplan            # read it
terraform apply nasa.tfplan

# 3. Settings (one SecureString per setting; values never go through Terraform)
aws ssm put-parameter --name /nasa/prod/DB_HOST --type SecureString --value '...'     # repeat for every name in Backend/.env.example

# 4. Release, then roll the instance
docs/infra/scripts/package-backend.sh "$(terraform output -raw artifact_bucket)"
aws autoscaling start-instance-refresh --auto-scaling-group-name "$(terraform output -raw asg_name)"
```

Then point DNS at `terraform output api_ip_for_dns` (direct mode). Parameter values must not contain newlines.

## Switching to the load balancer later

1. Add `GET /healthz` to the backend (200, no auth, no database call) and deploy it.
2. `enable_alb = true` (the NAT gateway turns on automatically), optionally `route53_zone_id` or an existing `acm_certificate_arn`.
3. `terraform apply`; if DNS is not in Route 53, create the records from `terraform output acm_validation_records`.
4. Move the `api_domain` record to `alb_dns_name`. Cost goes from about $30 to about $86 a month (see the cost document).

## Known gaps (on purpose, not forgotten)

- `asg_max = 1` until the cron jobs in `Backend` can run on one instance only. The scaling policy is ready.
- No database in this stack. The `data` subnets and security group are reserved for it; see the database section of the cost document.
- No WAF, no CloudFront, no multi-region.
- `user_data` assumes Amazon Linux 2023 has the `nodejs22` package and that the Caddy release URL for the pinned version exists: check on a throwaway instance.
- The state backend and any account IDs are never committed (`backend.hcl`, `terraform.tfvars` are ignored).
