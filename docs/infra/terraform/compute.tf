data "aws_ssm_parameter" "ami" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-${var.architecture}"
}

# Stable public address for direct mode. In ALB mode there is none (the ALB's DNS name or a CNAME is used).
resource "aws_eip" "direct" {
  count  = local.direct ? 1 : 0
  domain = "vpc"
  tags   = { Name = "${local.name}-direct" }
}

locals {
  user_data = templatefile("${path.module}/user_data.sh.tpl", {
    region            = var.region
    artifact_bucket   = aws_s3_bucket.artifacts.bucket
    ssm_path          = var.ssm_parameter_path
    app_port          = var.app_port
    direct            = local.direct ? "true" : "false"
    api_domain        = var.api_domain
    node_major        = var.node_major
    node_heap_mb      = var.node_heap_mb
    caddy_version     = var.caddy_version
    acme_email        = var.acme_email
    eip_allocation_id = local.direct ? aws_eip.direct[0].id : ""
  })
}

resource "aws_launch_template" "app" {
  name_prefix            = "${local.name}-app-"
  image_id               = data.aws_ssm_parameter.ami.value
  instance_type          = var.instance_type
  update_default_version = true
  user_data              = base64encode(local.user_data)

  iam_instance_profile {
    name = aws_iam_instance_profile.app.name
  }

  network_interfaces {
    associate_public_ip_address = local.direct
    security_groups             = [aws_security_group.app.id]
    delete_on_termination       = true
  }

  # IMDSv2 only; hop limit 1 so containers or a proxied request cannot read the instance credentials.
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  block_device_mappings {
    device_name = "/dev/xvda"
    ebs {
      volume_size           = var.root_volume_gb
      volume_type           = "gp3"
      encrypted             = true
      delete_on_termination = true
    }
  }

  dynamic "credit_specification" {
    for_each = startswith(var.instance_type, "t") ? [1] : []
    content {
      cpu_credits = var.cpu_credits
    }
  }

  monitoring {
    enabled = false # basic (5-minute) metrics are free; turn on for the load test
  }

  tag_specifications {
    resource_type = "instance"
    tags          = { Name = "${local.name}-app" }
  }
  tag_specifications {
    resource_type = "volume"
    tags          = { Name = "${local.name}-app" }
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_autoscaling_group" "app" {
  name                      = "${local.name}-app"
  min_size                  = var.asg_min
  desired_capacity          = var.asg_desired
  max_size                  = var.asg_max
  vpc_zone_identifier       = local.direct ? aws_subnet.public[*].id : aws_subnet.app[*].id
  health_check_type         = var.enable_alb ? "ELB" : "EC2"
  health_check_grace_period = 300
  target_group_arns         = var.enable_alb ? [aws_lb_target_group.app[0].arn] : []
  termination_policies      = ["OldestLaunchTemplate", "OldestInstance"]

  # The no-instances alarm reads GroupInServiceInstances, which needs group metrics switched on.
  metrics_granularity = "1Minute"
  enabled_metrics     = ["GroupInServiceInstances", "GroupDesiredCapacity"]

  launch_template {
    id      = aws_launch_template.app.id
    version = "$Latest"
  }

  # Replace instances launch-before-terminate, so a new version never means downtime.
  instance_refresh {
    strategy = "Rolling"
    preferences {
      min_healthy_percentage = 100
      max_healthy_percentage = 200
      instance_warmup        = 180
    }
  }

  tag {
    key                 = "Name"
    value               = "${local.name}-app"
    propagate_at_launch = true
  }

  lifecycle {
    ignore_changes = [desired_capacity] # a scale-in/out decided by the group is not undone by the next apply
  }
}

# Only acts when asg_max > 1.
resource "aws_autoscaling_policy" "cpu" {
  name                   = "${local.name}-cpu-target"
  autoscaling_group_name = aws_autoscaling_group.app.name
  policy_type            = "TargetTrackingScaling"

  target_tracking_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ASGAverageCPUUtilization"
    }
    target_value = var.scale_out_cpu_target
  }
}
