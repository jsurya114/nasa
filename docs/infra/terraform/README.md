# NASA AWS infrastructure (Terraform)

Migration write-up: [`docs/infra/VPC_MIGRATION.md`](../VPC_MIGRATION.md). Plan and reasoning: [`docs/infra/AWS_NETWORK_PLAN.md`](../AWS_NETWORK_PLAN.md). Costs and the database: [`docs/infra/AWS_COST_OPTIMISATION.md`](../AWS_COST_OPTIMISATION.md). Load test: [`docs/infra/loadtest/`](../../docs/infra/loadtest/README.md).

**Status: applied in production on 2026-11-21; production traffic moved to it on 2026-11-24.** The full story (old and new setup, the reasons, the cutover, the rollback, what is next and how to operate it) is in [`docs/infra/VPC_MIGRATION.md`](../VPC_MIGRATION.md). Before that, on 2026-11-20 the stack ran in the NASA account as `environment = "staging"` (direct mode, `t4g.micro`, its own test database), the bootstrap booted on a real instance, the load test ran ([results](../loadtest/README.md#results)), and everything was destroyed again. `terraform validate` and `terraform test` (`tests/modes.tftest.hcl`, mocked provider) pass.

**Account lock.** `aws_profile` and `aws_account_id` have no defaults, and the provider sets `allowed_account_ids`, so Terraform refuses to run against any other account. Both go in your local `terraform.tfvars` and `backend.hcl` (both git-ignored). The account ID never goes in the repository.

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
#    easiest: docs/infra/scripts/copy-env-to-ssm.py <copy of the old .env> (dry run first, then --apply)
aws ssm put-parameter --name /nasa/prod/DB_HOST --type SecureString --value '...'     # repeat for every name in Backend/.env.example

# 4. Release, then roll the instance
docs/infra/scripts/package-backend.sh "$(terraform output -raw artifact_bucket)"
aws autoscaling start-instance-refresh --auto-scaling-group-name "$(terraform output -raw asg_name)"
```

Then point DNS at `terraform output api_ip_for_dns` (direct mode).

The bootstrap writes the settings with `render-env.cjs`. It quotes each value so the release's own dotenv reads it back exactly, including line breaks (for example a PEM certificate), backslashes and quotes, and it checks that before the app starts. A value it can't carry stops the bootstrap with the setting's name, never its value: a carriage return, a trailing backslash, or all three quote characters. Test: `node --test docs/infra/terraform/tests/render-env.test.cjs`.

## Peering to the default VPC (database stays where it is)

`peer_default_vpc = true` plus `peer_db_security_group_id = "sg-..."` (existing database group, in `terraform.tfvars`). It adds one peering connection, one route in each VPC and one 5432 rule on that group, nothing else. The existing route table and group are read with data sources only, never managed. If the database's subnets use a custom route table, also set `peer_db_route_table_id`. In `terraform plan` every one of these must show as `create`, and nothing in the default VPC as change, replace or destroy.

`SCHEDULED_JOBS_ENABLED=false` in the backend settings keeps the three scheduled jobs off on a server that shares the database with another one. Set it to `true` only after the other server is stopped.

## Switching to the load balancer later

1. Make sure the deployed backend has `GET /healthz` (200, no sign-in, no database call). It is added on this branch, and the bootstrap already waits for it.
2. `enable_alb = true` (the NAT gateway turns on automatically), optionally `route53_zone_id` or an existing `acm_certificate_arn`.
3. `terraform apply`; if DNS is not in Route 53, create the records from `terraform output acm_validation_records`.
4. Move the `api_domain` record to `alb_dns_name`. This adds about $50 to $60 a month: the load balancer, the NAT gateway and their public addresses (see the cost document).

## Staging (load tests only)

`environment = "staging"` with a separate state key, a separate tfvars file and the deployer role in [`docs/infra/iam/`](../iam/). The staging-only switches `install_local_redis`, `create_test_database` and `create_load_generator` are refused by validation when `environment = "prod"`. In staging the backend gets an allow-list of settings, with no Everee, QuickBooks, email, push, Cloudinary or AI connector settings, so it cannot reach real people or real money. Destroy the stack after each session. Running cost while it exists is about $0.07 an hour.

```bash
terraform init -reconfigure -backend-config=backend-staging.hcl
terraform plan -var-file=staging.tfvars -out staging.tfplan
terraform test -var-file=staging.tfvars
```

## Known gaps (on purpose, not forgotten)

- `asg_max = 1` until the scheduled jobs in `Backend` can run on one instance only. The scaling policy is ready.
- No production database in this stack. Production stays on the existing RDS in the default VPC, reached over VPC peering. The `data` subnets and security group are reserved for a later move.
- No WAF, no CloudFront, no multi-region.
- The state backend and any account IDs are never committed (`backend.hcl`, `terraform.tfvars`, `*.tfvars` are ignored).
