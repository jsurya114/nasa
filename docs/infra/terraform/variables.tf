############################################
# General
############################################
variable "project" {
  type    = string
  default = "nasa"
}

variable "environment" {
  type    = string
  default = "prod"
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
  description = "Must match architecture. Starting point: t4g.medium (2 vCPU, 4 GiB). Confirm with the load test before committing to a size or a Savings Plan."
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
  description = "Node old-space limit (--max-old-space-size), about 40% of the instance memory so Excel parsing cannot take the whole machine. 1536 suits 4 GiB; use 700 for 2 GiB."
  type        = number
  default     = 1536
}

variable "caddy_version" {
  type    = string
  default = "2.10.0"
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
