############################################
# General
############################################
variable "project" {
  type    = string
  default = "nasa"
}

variable "environment" {
  description = "prod or staging. Staging-only resources (test database, load generator) refuse to exist in prod."
  type        = string
  default     = "prod"
  validation {
    condition     = contains(["prod", "staging"], var.environment)
    error_message = "environment must be prod or staging."
  }
}

variable "aws_profile" {
  description = "Named AWS CLI profile for the NASA account. No default, so another project's profile is never used by accident."
  type        = string
}

variable "aws_account_id" {
  description = "The NASA AWS account ID (12 digits). The provider refuses credentials from any other account."
  type        = string
  validation {
    condition     = can(regex("^[0-9]{12}$", var.aws_account_id))
    error_message = "aws_account_id must be the 12-digit NASA account ID."
  }
}

variable "region" {
  description = "AWS region. Pick the region closest to the drivers (US). CONFIRM against where the current server runs before applying."
  type        = string
  default     = "us-east-1"
}

variable "extra_tags" {
  type    = map(string)
  default = {}
}

############################################
# Network
############################################
variable "vpc_cidr" {
  description = "Kept away from the default VPC range (172.31.0.0/16) so the two can be peered during the migration."
  type        = string
  default     = "10.20.0.0/16"
}

variable "az_count" {
  description = "Availability Zones used (2 is enough for now; 3 keeps room for later)."
  type        = number
  default     = 2
  validation {
    condition     = var.az_count >= 2 && var.az_count <= 3
    error_message = "az_count must be 2 or 3."
  }
}

variable "enable_nat_gateway" {
  description = "NAT gateway for private subnets (about $33/month + data). Forced on when enable_alb is true, because private instances need it to reach Everee, QuickBooks, Cloudinary, Redis and the database."
  type        = bool
  default     = false
}

variable "nat_per_az" {
  description = "One NAT gateway per AZ (high availability, doubles the cost). false = a single shared NAT."
  type        = bool
  default     = false
}

variable "enable_flow_logs" {
  description = "VPC flow logs to CloudWatch (small cost; turn on while investigating)."
  type        = bool
  default     = false
}

variable "db_port" {
  description = "Port of the future database tier security group / NACL."
  type        = number
  default     = 5432
}

############################################
# Entry point: ALB (off by default to save ~$16/month) or direct to the instance
############################################
variable "enable_alb" {
  description = "false = traffic goes straight to the instance (Caddy on the instance, public subnet, Elastic IP), like today. true = Application Load Balancer in front, instances in private subnets."
  type        = bool
  default     = false
}

variable "api_domain" {
  description = "Public API host name, for example api.nasaroutes.com. Used by Caddy (direct mode) and the ALB certificate."
  type        = string
  default     = "api.nasaroutes.com"
}

variable "existing_eip_allocation_id" {
  description = "Direct mode: the allocation ID of an Elastic IP that already exists and that api_domain already points at (for example the one moved to the new server at the production cutover). Terraform manages it (it was imported once, in the production follow-up of 24 November 2026) instead of creating a new one. Dropping this variable makes the plan fail on purpose (prevent_destroy), so keep it set. Empty (the default) creates a new Elastic IP. Set it only in your local terraform.tfvars: it is not secret, but IDs stay out of the repository."
  type        = string
  default     = ""

  validation {
    condition     = var.existing_eip_allocation_id == "" || can(regex("^eipalloc-[0-9a-f]{8,17}$", var.existing_eip_allocation_id))
    error_message = "existing_eip_allocation_id must be empty or look like eipalloc-0123456789abcdef0."
  }
}

variable "acm_certificate_arn" {
  description = "Existing ACM certificate for api_domain (ALB mode). Leave empty to have Terraform request one (DNS validation)."
  type        = string
  default     = ""
}

variable "route53_zone_id" {
  description = "Optional Route 53 zone for the certificate validation record. Leave empty if DNS is elsewhere (create the record from the output by hand)."
  type        = string
  default     = ""
}

variable "health_check_path" {
  description = "ALB health check. The backend has NO health route today: add GET /healthz (returns 200, no auth, no database call) BEFORE enabling the ALB."
  type        = string
  default     = "/healthz"
}

variable "acme_email" {
  description = "Contact email for Let's Encrypt certificates issued by Caddy (direct mode)."
  type        = string
  default     = ""
}

############################################
# Compute
############################################
variable "architecture" {
  description = "arm64 (Graviton: t4g, cheaper per unit) or x86_64. The backend has no native dependency that blocks arm64 (bcrypt ships arm64 prebuilds); test on a copy first."
  type        = string
  default     = "arm64"
  validation {
    condition     = contains(["arm64", "x86_64"], var.architecture)
    error_message = "architecture must be arm64 or x86_64."
  }
}

variable "instance_type" {
  description = "Must match architecture. Being tested: t4g.micro (2 vCPU, 1 GiB), then t4g.small (2 GiB) if micro lacks headroom. Confirm with the load test before committing to a size or a Savings Plan."
  type        = string
  default     = "t4g.medium"
}

variable "cpu_credits" {
  description = "Burstable instances only: unlimited avoids throttling when credits run out but bills surplus credits; standard throttles to the baseline."
  type        = string
  default     = "unlimited"
  validation {
    condition     = contains(["unlimited", "standard"], var.cpu_credits)
    error_message = "cpu_credits must be unlimited or standard."
  }
}

variable "root_volume_gb" {
  type    = number
  default = 20
}

variable "app_port" {
  description = "Port the Node backend listens on (PORT)."
  type        = number
  default     = 3251
}

variable "node_major" {
  description = "Node major version installed by the instance bootstrap (the repo pins Node 22)."
  type        = number
  default     = 22
}

variable "node_heap_mb" {
  description = "Node old-space limit (--max-old-space-size). null = chosen from the instance size (about 40% of its memory: 384 on 1 GiB, 768 on 2 GiB, 1536 on 4 GiB), so a production-sized heap is never put on a small machine."
  type        = number
  default     = null
  validation {
    condition     = var.node_heap_mb == null ? true : (var.node_heap_mb >= 128 && var.node_heap_mb <= 16384)
    error_message = "node_heap_mb must be null or between 128 and 16384."
  }
}

variable "swap_mb" {
  description = "Swap file size on the instance (0 = none, the default). Only add swap if a load test shows it is needed; it hides memory pressure as slowness."
  type        = number
  default     = 0
}

variable "caddy_version" {
  type    = string
  default = "2.10.0"
}

variable "public_ingress_cidrs" {
  description = "Direct mode: who may reach ports 80 and 443 on the instance. Production: the whole internet. Staging: empty, so only the load generator (by security group) can connect."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "tls_mode" {
  description = "Direct mode: acme = a public Let's Encrypt certificate for api_domain (needs DNS pointing at the Elastic IP). internal = Caddy's own private certificate authority, for a staging host that has no public DNS name; HTTPS is still measured."
  type        = string
  default     = "acme"
  validation {
    condition     = contains(["acme", "internal"], var.tls_mode)
    error_message = "tls_mode must be acme or internal."
  }
}

variable "detailed_monitoring" {
  description = "1-minute EC2 metrics (a small charge per instance). Off in production; on for a load test."
  type        = bool
  default     = false
}

variable "app_single_az" {
  description = "Keep the backend in the first AZ only. Staging uses it so the load generator (second AZ) never shares a zone with it."
  type        = bool
  default     = false
}

variable "asg_min" {
  type    = number
  default = 1
}

variable "asg_desired" {
  description = "1 for cost. Raise only after the in-process cron jobs are made single-runner (see README)."
  type        = number
  default     = 1
}

variable "asg_max" {
  description = "Kept at 1 on purpose: the backend runs hourly/5-minute/15-minute cron jobs inside the web process (availability reset, Everee sync). A second instance would run them twice. Raise to 2+ only after a leader lock exists."
  type        = number
  default     = 1
}

variable "scale_out_cpu_target" {
  description = "Target-tracking CPU % used when asg_max > 1."
  type        = number
  default     = 60
}

variable "ssm_parameter_path" {
  description = "SSM Parameter Store path holding the backend settings (SecureString). One parameter per setting: /nasa/prod/DB_HOST ... Values are created by hand, never by Terraform (so no secret reaches the state file)."
  type        = string
  default     = "/nasa/prod"
}

############################################
# Alerts and cost guard
############################################
variable "alert_email" {
  description = "Receives CloudWatch alarms and budget alerts. Leave empty to create the alarms without notifications."
  type        = string
  default     = ""
}

variable "monthly_budget_usd" {
  type    = number
  default = 100
}

############################################
# Staging only: load test helpers. All refuse to exist when environment = "prod".
############################################
variable "install_local_redis" {
  description = "Staging only: run a small Redis on the instance (127.0.0.1 only) instead of the hosted production Redis."
  type        = bool
  default     = false
  validation {
    condition     = !(var.install_local_redis && var.environment == "prod")
    error_message = "install_local_redis is for staging only; it cannot be set when environment = \"prod\"."
  }
}

variable "create_test_database" {
  description = "Staging only: an isolated PostgreSQL RDS instance in the data subnets for synthetic test data. Never a copy of production unless an anonymised snapshot is approved."
  type        = bool
  default     = false
  validation {
    condition     = !(var.create_test_database && var.environment == "prod")
    error_message = "create_test_database is for staging only; it cannot be set when environment = \"prod\"."
  }
}

variable "test_db_engine_version" {
  description = "PostgreSQL version of the test database: the production RDS major version (17, confirmed 2026-11-20; production runs 17.9)."
  type        = string
  default     = "17"
}

variable "test_db_instance_class" {
  description = "Same class as production (db.t3.micro, confirmed 2026-11-20), so the test measures the database NASA really has."
  type        = string
  default     = "db.t3.micro"
}

variable "create_load_generator" {
  description = "Staging only: a separate instance (second AZ) that runs the load test, so its CPU never counts against the backend."
  type        = bool
  default     = false
  validation {
    condition     = !(var.create_load_generator && var.environment == "prod")
    error_message = "create_load_generator is for staging only; it cannot be set when environment = \"prod\"."
  }
}

variable "load_generator_instance_type" {
  type    = string
  default = "t4g.small"
}

variable "staging_rate_limit_max" {
  description = "Staging only: requests per 15 minutes the single load generator address may make (STAGING_GLOBAL_RATE_LIMIT_MAX, 1000 to 100000)."
  type        = number
  default     = 100000
}

variable "role_permissions_boundary_arn" {
  description = "IAM permissions boundary put on every role this stack creates. Required by docs/infra/iam/nasa-staging-provisioner-policy.json (create docs/infra/iam/nasa-staging-role-boundary.json as policy nasa-staging-role-boundary first). null = none."
  type        = string
  default     = null
}

############################################
# Peering to the default VPC (production database stays there)
############################################
variable "peer_default_vpc" {
  description = "Peer this VPC with the account's default VPC, where the production RDS lives, so the backend here can reach it. Adds ONLY: the peering connection, one route in each VPC and one database-port rule on the database security group. Nothing existing is imported or changed."
  type        = bool
  default     = false
}

variable "peer_db_security_group_id" {
  description = "ID of the existing database security group (sg-...) in the default VPC that receives the new rule. Required when peer_default_vpc is true. Set it in terraform.tfvars, not in the repo."
  type        = string
  default     = ""
}

variable "peer_db_route_table_id" {
  description = "Route table used by the database's subnets in the default VPC. Leave empty to use the default VPC's main route table (the usual case); set it if the database subnets use a custom table."
  type        = string
  default     = ""
}

variable "drill_log_retention_days" {
  description = "Days after upload when the logs saved before the recovery drill are deleted (the private drill-logs bucket, production only). The agreed rule is about 30 days after the old server is deleted; 35 covers a drill on 27 November and the old server gone by 1 December. Adjust when that date is fixed."
  type        = number
  default     = 35
  validation {
    condition     = var.drill_log_retention_days >= 7 && var.drill_log_retention_days <= 90
    error_message = "Keep the saved logs between 7 and 90 days."
  }
}
