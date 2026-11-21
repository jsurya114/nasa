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
  # About 40% of memory for the Node heap: room for the OS, Caddy, the rest of Node's memory and (staging) Redis.
  heap_by_type = { "t4g.nano" = 192, "t4g.micro" = 384, "t3.micro" = 384, "t4g.small" = 768, "t3.small" = 768, "t4g.medium" = 1536, "t3.medium" = 1536 }
  node_heap_mb = coalesce(var.node_heap_mb, lookup(local.heap_by_type, var.instance_type, 1536))

  user_data = templatefile("${path.module}/user_data.sh.tpl", {
    region            = var.region
    environment       = var.environment
    artifact_bucket   = aws_s3_bucket.artifacts.bucket
    ssm_path          = var.ssm_parameter_path
    app_port          = var.app_port
    direct            = local.direct ? "true" : "false"
    api_domain        = var.api_domain
    tls_mode          = var.tls_mode
    node_major        = var.node_major
    node_heap_mb      = local.node_heap_mb
    swap_mb           = var.swap_mb
    caddy_version     = var.caddy_version
    acme_email        = var.acme_email
    eip_allocation_id = local.direct ? aws_eip.direct[0].id : ""
    local_redis       = local.staging && var.install_local_redis ? "true" : "false"
    test_db_host      = local.test_database ? aws_db_instance.test[0].address : ""
    test_db_port      = local.test_database ? aws_db_instance.test[0].port : 0
    test_db_name      = local.test_database ? aws_db_instance.test[0].db_name : ""
    test_db_user      = local.test_database ? aws_db_instance.test[0].username : ""
    test_db_secret    = local.test_database ? aws_db_instance.test[0].master_user_secret[0].secret_arn : ""
    rate_limit_max    = var.staging_rate_limit_max
    render_env_js     = file("${path.module}/render-env.cjs")
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
    enabled = var.detailed_monitoring # basic (5-minute) metrics are free; 1-minute metrics for a load test
  }

  tag_specifications {
    resource_type = "instance"
    tags          = { Name = "${local.name}-app", Environment = var.environment, Project = var.project }
  }
  tag_specifications {
    resource_type = "volume"
    tags          = { Name = "${local.name}-app", Environment = var.environment, Project = var.project }
  }
  # Tagged too, so a staging role limited to Environment=staging resources can attach the Elastic IP.
  tag_specifications {
    resource_type = "network-interface"
    tags          = { Name = "${local.name}-app", Environment = var.environment, Project = var.project }
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
  vpc_zone_identifier       = var.app_single_az ? [local.backend_subnets[0]] : local.backend_subnets
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

  # Terminate-then-launch while there is one instance. The backend runs scheduled jobs (availability reset, Everee
  # checks) inside the web process, so two overlapping instances would run them twice; a refresh therefore costs a few
  # minutes of downtime. Overlap (min 100 / max 200) is only allowed once those jobs take a single-runner lock.
  instance_refresh {
    strategy = "Rolling"
    preferences {
      min_healthy_percentage = var.asg_max > 1 ? 100 : 0
      max_healthy_percentage = var.asg_max > 1 ? 200 : 100
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
