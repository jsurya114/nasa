terraform {
  required_version = ">= 1.10"

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

provider "aws" {
  region = var.region

  default_tags {
    tags = merge({
      Project     = var.project
      Environment = var.environment
      ManagedBy   = "terraform"
    }, var.extra_tags)
  }
}
