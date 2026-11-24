terraform {
  required_version = ">= 1.11" # 1.10 for the S3 state lock, 1.11 for override_during in tests/modes.tftest.hcl

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # Remote state. Create the bucket first with ../bootstrap, then run:
  #   terraform init -backend-config=backend.hcl
  # (backend.hcl is not committed: see backend.hcl.example.) Native S3 locking, no DynamoDB table needed.
  backend "s3" {}
}

# The account guard: Terraform stops before touching anything if the profile's credentials belong to any other
# account (for example another project's profile on the same computer). There is no default for either value.
provider "aws" {
  region              = var.region
  profile             = var.aws_profile
  allowed_account_ids = [var.aws_account_id]

  default_tags {
    tags = merge({
      Project     = var.project
      Environment = var.environment
      ManagedBy   = "terraform"
    }, var.extra_tags)
  }
}
