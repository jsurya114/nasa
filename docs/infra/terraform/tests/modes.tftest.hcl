# Plans both modes against a MOCKED AWS provider (no credentials, nothing is created) and checks the switches do what the README says.
mock_provider "aws" {
  override_during = plan

  mock_data "aws_availability_zones" {
    defaults = {
      names = ["us-east-1a", "us-east-1b", "us-east-1c"]
    }
  }
  mock_data "aws_caller_identity" {
    defaults = {
      account_id = "123456789012"
    }
  }
  mock_data "aws_vpc" {
    defaults = {
      id         = "vpc-0123456789abcdef0"
      cidr_block = "172.31.0.0/16"
    }
  }
  mock_data "aws_route_table" {
    defaults = {
      id = "rtb-0123456789abcdef0"
    }
  }
  mock_data "aws_ssm_parameter" {
    defaults = {
      value = "ami-0123456789abcdef0"
    }
  }
  mock_data "aws_iam_policy_document" {
    defaults = {
      json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}"
    }
  }
  mock_resource "aws_iam_role" {
    defaults = {
      arn = "arn:aws:iam::123456789012:role/mock"
    }
  }
  mock_resource "aws_eip" {
    defaults = {
      id        = "eipalloc-0123456789abcdef0"
      public_ip = "198.51.100.10"
      arn       = "arn:aws:ec2:us-east-1:123456789012:elastic-ip/eipalloc-0123456789abcdef0"
    }
  }
  mock_resource "aws_s3_bucket" {
    defaults = {
      bucket = "nasa-mock-artifacts"
      arn    = "arn:aws:s3:::nasa-mock-artifacts"
    }
  }
  mock_resource "aws_db_instance" {
    defaults = {
      address            = "nasa-staging-loadtest-db.mock.us-east-1.rds.amazonaws.com"
      port               = 5432
      master_user_secret = [{ secret_arn = "arn:aws:secretsmanager:us-east-1:123456789012:secret:rds-mock", kms_key_id = "", secret_status = "active" }]
    }
  }
}

# Every run needs the account guard: no default exists for either value.
variables {
  aws_profile    = "nasa-test"
  aws_account_id = "123456789012"
}

run "direct_mode_is_the_cheap_default" {
  command = plan

  assert {
    condition     = length(aws_lb.app) == 0 && length(aws_nat_gateway.main) == 0
    error_message = "Default must create no ALB and no NAT gateway."
  }
  assert {
    condition     = length(aws_eip.direct) == 1
    error_message = "Direct mode needs one Elastic IP."
  }
  assert {
    condition     = length(aws_vpc_security_group_ingress_rule.app_direct) == 2
    error_message = "Direct mode must open 443 on the app group."
  }
  assert {
    condition     = aws_autoscaling_group.app.desired_capacity == 1 && aws_autoscaling_group.app.max_size == 1
    error_message = "Auto Scaling group must start at one instance."
  }
  assert {
    condition     = length(aws_subnet.public) == 2 && length(aws_subnet.app) == 2 && length(aws_subnet.data) == 2
    error_message = "Two subnets per tier."
  }
}

run "alb_mode_adds_alb_and_nat_and_closes_the_instance" {
  command = plan

  variables {
    enable_alb          = true
    acm_certificate_arn = "arn:aws:acm:us-east-1:123456789012:certificate/00000000-0000-0000-0000-000000000000"
  }

  assert {
    condition     = length(aws_lb.app) == 1 && length(aws_lb_listener.https) == 1 && length(aws_lb_listener.http_redirect) == 1
    error_message = "ALB mode must create the ALB and both listeners."
  }
  assert {
    condition     = length(aws_nat_gateway.main) == 1
    error_message = "ALB mode must turn the NAT gateway on (private instances need it)."
  }
  assert {
    condition     = length(aws_eip.direct) == 0 && length(aws_vpc_security_group_ingress_rule.app_direct) == 0
    error_message = "ALB mode must not expose the instance directly."
  }
}

run "alb_mode_requests_its_own_certificate_when_none_is_given" {
  command = plan

  variables {
    enable_alb = true
  }

  assert {
    condition     = length(aws_acm_certificate.api) == 1
    error_message = "With no certificate ARN the ALB mode must request one."
  }
}

run "prod_default_keeps_production_settings" {
  command = plan

  assert {
    condition     = length(aws_db_instance.test) == 0 && length(aws_instance.load_generator) == 0
    error_message = "Production must never create a test database or a load generator."
  }
  assert {
    condition     = local.node_heap_mb == 1536 && strcontains(local.user_data, "--max-old-space-size=1536")
    error_message = "The default t4g.medium keeps a 1536 MB heap."
  }
  assert {
    condition     = strcontains(local.user_data, "get-parameters-by-path") && !strcontains(local.user_data, "NASA_ENVIRONMENT=staging")
    error_message = "Production reads its settings from SSM and never marks itself staging."
  }
  assert {
    condition     = aws_autoscaling_group.app.instance_refresh[0].preferences[0].max_healthy_percentage == 100 && aws_autoscaling_group.app.instance_refresh[0].preferences[0].min_healthy_percentage == 0
    error_message = "With one instance a refresh must never run two backends (the scheduled jobs would run twice)."
  }
  assert {
    condition     = strcontains(local.user_data, "nodejs22-npm") && strcontains(local.user_data, "npm --version")
    error_message = "Bootstrap installs and checks npm explicitly."
  }
  assert {
    condition     = strcontains(local.user_data, "Elastic IP was NOT moved") && strcontains(local.user_data, "--allow-reassociation")
    error_message = "Bootstrap waits for /healthz before it moves the Elastic IP."
  }
  assert {
    condition     = strcontains(local.user_data, "function quote(value)") && strcontains(local.user_data, "render-env.cjs \"$SSM_JSON\"") && !strcontains(local.user_data, "@json))")
    error_message = "Production settings are written by render-env.cjs (checked with dotenv), not as raw JSON strings."
  }
  assert {
    condition     = length(local.user_data) < 16384
    error_message = "EC2 user data must stay under 16 KB."
  }
}

run "staging_micro_with_test_database_and_load_generator" {
  command = plan

  variables {
    environment           = "staging"
    instance_type         = "t4g.micro"
    public_ingress_cidrs  = []
    tls_mode              = "internal"
    api_domain            = "staging-api.nasa.test"
    install_local_redis   = true
    create_test_database  = true
    create_load_generator = true
    detailed_monitoring   = true
    app_single_az         = true
    ssm_parameter_path    = "/nasa/staging"
    monthly_budget_usd    = 10
  }

  assert {
    condition     = local.name == "nasa-staging" && aws_autoscaling_group.app.name == "nasa-staging-app"
    error_message = "Every staging name says staging."
  }
  assert {
    condition     = local.node_heap_mb == 384 && strcontains(local.user_data, "--max-old-space-size=384")
    error_message = "A 1 GiB t4g.micro gets a 384 MB heap, not the production 1536."
  }
  assert {
    condition     = length(aws_db_instance.test) == 1 && aws_db_instance.test[0].publicly_accessible == false && aws_db_instance.test[0].storage_encrypted && aws_db_instance.test[0].manage_master_user_password
    error_message = "The test database is private, encrypted and keeps its password out of state."
  }
  assert {
    condition     = aws_db_instance.test[0].skip_final_snapshot && aws_db_instance.test[0].backup_retention_period == 0 && !aws_db_instance.test[0].deletion_protection
    error_message = "The test database is throwaway: destroy removes it completely."
  }
  assert {
    condition     = length(aws_instance.load_generator) == 1 && length(aws_vpc_security_group_ingress_rule.app_from_load_generator) == 1
    error_message = "Staging has its own load generator, allowed in by security group."
  }
  assert {
    condition     = length(aws_vpc_security_group_ingress_rule.app_direct) == 0
    error_message = "With no public_ingress_cidrs the staging backend is closed to the internet."
  }
  assert {
    condition     = length(aws_autoscaling_group.app.vpc_zone_identifier) == 1
    error_message = "The staging backend stays in one AZ, away from the load generator."
  }
  assert {
    condition     = strcontains(local.user_data, "NASA_ENVIRONMENT=staging") && strcontains(local.user_data, "allow-list") && strcontains(local.user_data, "tls internal") && strcontains(local.user_data, "valkey")
    error_message = "Staging bootstrap uses the allow-list, private TLS and a local Redis."
  }
  assert {
    condition     = !strcontains(local.user_data, "get-parameters-by-path")
    error_message = "Staging never reads an SSM settings path (so it cannot pick up production settings)."
  }
  assert {
    condition     = aws_launch_template.app.monitoring[0].enabled
    error_message = "Detailed monitoring is on for the load test."
  }
  assert {
    condition     = contains([for r in aws_network_acl_rule.r : r.cidr_block if r.rule_number == 100 && !r.egress && r.from_port == 5432], "10.20.0.0/24")
    error_message = "In direct mode the data tier must accept the database port from the public subnets, where the backend runs."
  }
}

run "prod_refuses_staging_only_switches" {
  command = plan

  variables {
    create_test_database = true
  }

  expect_failures = [var.create_test_database]
}

run "account_id_must_be_twelve_digits" {
  command = plan

  variables {
    aws_account_id = "my-account"
  }

  expect_failures = [var.aws_account_id]
}

run "peering_is_off_by_default_and_adds_nothing" {
  command = plan

  assert {
    condition     = length(aws_vpc_peering_connection.default) == 0 && length(aws_route.peer_from_public) == 0 && length(aws_route.peer_from_app) == 0 && length(aws_route.peer_to_new_vpc) == 0 && length(aws_vpc_security_group_ingress_rule.db_from_new_vpc_app) == 0
    error_message = "With peer_default_vpc false nothing about peering may be planned."
  }
}

run "peering_on_adds_one_connection_one_route_per_side_and_one_database_rule" {
  command = plan

  variables {
    peer_default_vpc          = true
    peer_db_security_group_id = "sg-0123456789abcdef0"
  }

  assert {
    condition     = length(aws_vpc_peering_connection.default) == 1 && aws_vpc_peering_connection.default[0].auto_accept
    error_message = "One peering connection, accepted automatically (same account and region)."
  }
  assert {
    condition     = aws_vpc_peering_connection_options.default[0].requester[0].allow_remote_vpc_dns_resolution && aws_vpc_peering_connection_options.default[0].accepter[0].allow_remote_vpc_dns_resolution
    error_message = "DNS resolution over the peering must be on for both sides."
  }
  assert {
    condition     = aws_route.peer_from_public[0].destination_cidr_block == "172.31.0.0/16" && length(aws_route.peer_from_app) == 2
    error_message = "The new VPC's public table and each app table route the default VPC range to the peering."
  }
  assert {
    condition     = aws_route.peer_to_new_vpc[0].destination_cidr_block == "10.20.0.0/16" && aws_route.peer_to_new_vpc[0].route_table_id == "rtb-0123456789abcdef0"
    error_message = "The default VPC's database table gets exactly one route back to the new range."
  }
  assert {
    condition     = aws_vpc_security_group_ingress_rule.db_from_new_vpc_app[0].security_group_id == "sg-0123456789abcdef0" && aws_vpc_security_group_ingress_rule.db_from_new_vpc_app[0].from_port == 5432 && aws_vpc_security_group_ingress_rule.db_from_new_vpc_app[0].to_port == 5432 && aws_vpc_security_group_ingress_rule.db_from_new_vpc_app[0].description == "NASA new VPC backend"
    error_message = "One rule on the existing database group: port 5432 from the new app group."
  }
}

run "peering_without_a_database_security_group_is_refused" {
  command = plan

  variables {
    peer_default_vpc = true
  }

  expect_failures = [aws_vpc_peering_connection.default]
}

run "peering_with_a_range_inside_the_default_vpc_is_refused" {
  command = plan

  variables {
    peer_default_vpc          = true
    peer_db_security_group_id = "sg-0123456789abcdef0"
    vpc_cidr                  = "172.31.0.0/20"
  }

  expect_failures = [aws_vpc_peering_connection.default]
}

# Adopting an existing Elastic IP (the production follow-up): the one that exists is imported and managed, none is created
# beside it, and everything that needs "the" address (the boot script, the instance's permission) reads the adopted one.
run "an_existing_elastic_ip_is_adopted_instead_of_created" {
  command = plan

  variables {
    existing_eip_allocation_id = "eipalloc-0abc1234def567890"
  }

  # The address is already in the state in production; here the mock provider is given its values
  # at plan time, so the checks below can read them.
  override_resource {
    target          = aws_eip.api["api"]
    override_during = plan
    values = {
      id        = "eipalloc-0abc1234def567890"
      public_ip = "198.51.100.20"
      arn       = "arn:aws:ec2:us-east-1:123456789012:elastic-ip/eipalloc-0abc1234def567890"
    }
  }

  assert {
    condition     = length(aws_eip.api) == 1 && length(aws_eip.direct) == 0
    error_message = "Adopting must manage exactly the existing address and create no second one."
  }
  assert {
    condition     = output.api_ip_for_dns == "198.51.100.20"
    error_message = "The address handed out for DNS must be the adopted one."
  }
}

run "a_malformed_elastic_ip_id_is_refused" {
  command = plan

  variables {
    existing_eip_allocation_id = "not-an-allocation-id"
  }

  expect_failures = [var.existing_eip_allocation_id]
}

run "prod_has_a_private_encrypted_drill_log_bucket_that_expires" {
  command = plan

  assert {
    condition     = length(aws_s3_bucket.drill_logs) == 1 && aws_s3_bucket_public_access_block.drill_logs[0].block_public_acls && aws_s3_bucket_public_access_block.drill_logs[0].block_public_policy && aws_s3_bucket_public_access_block.drill_logs[0].ignore_public_acls && aws_s3_bucket_public_access_block.drill_logs[0].restrict_public_buckets
    error_message = "Production gets one drill-log bucket with public access fully blocked."
  }
  assert {
    condition     = one(aws_s3_bucket_lifecycle_configuration.drill_logs[0].rule).expiration[0].days == 35
    error_message = "Saved logs expire after 35 days by default."
  }
}

run "drill_log_retention_is_bounded" {
  command = plan
  variables {
    drill_log_retention_days = 3
  }
  expect_failures = [var.drill_log_retention_days]
}

run "staging_has_no_drill_log_bucket" {
  command = plan

  variables {
    environment           = "staging"
    instance_type         = "t4g.micro"
    public_ingress_cidrs  = []
    tls_mode              = "internal"
    api_domain            = "staging-api.nasa.test"
    install_local_redis   = true
    create_test_database  = true
    create_load_generator = true
    detailed_monitoring   = true
    app_single_az         = true
    ssm_parameter_path    = "/nasa/staging"
    monthly_budget_usd    = 10
  }

  assert {
    condition     = length(aws_s3_bucket.drill_logs) == 0
    error_message = "Staging never creates the drill-log bucket."
  }
}

run "a_crash_writes_no_core_dump_and_swap_is_used_only_under_pressure" {
  command = plan

  variables {
    swap_mb      = 2048
    node_heap_mb = 768
  }

  assert {
    condition     = strcontains(local.user_data, "LimitCORE=0") && strcontains(local.user_data, "--max-old-space-size=768")
    error_message = "The service has no core dump, and the heap variable reaches the unit."
  }
  assert {
    condition     = strcontains(local.user_data, "dd if=/dev/zero of=/swapfile bs=1M count=2048") && strcontains(local.user_data, "vm.swappiness=10")
    error_message = "A 2 GiB swap file is created and used only under memory pressure."
  }
}
