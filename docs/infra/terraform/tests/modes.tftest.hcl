# Plans both modes against a MOCKED AWS provider (no credentials, nothing is created) and checks the switches do what the README says.
mock_provider "aws" {
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
    condition     = length(aws_vpc_security_group_ingress_rule.app_direct_https) == 1
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
    condition     = length(aws_eip.direct) == 0 && length(aws_vpc_security_group_ingress_rule.app_direct_https) == 0
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
