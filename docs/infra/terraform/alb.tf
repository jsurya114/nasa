# Everything here is created only when enable_alb = true (about $16/month plus usage, and it forces the NAT gateway on).

resource "aws_lb" "app" {
  count                      = var.enable_alb ? 1 : 0
  name                       = "${local.name}-alb"
  load_balancer_type         = "application"
  internal                   = false
  security_groups            = [aws_security_group.alb.id]
  subnets                    = aws_subnet.public[*].id
  idle_timeout               = 120 # Excel uploads and reports can be slow
  drop_invalid_header_fields = true
  enable_deletion_protection = false
  tags                       = { Name = "${local.name}-alb" }
}

resource "aws_lb_target_group" "app" {
  count                = var.enable_alb ? 1 : 0
  name                 = "${local.name}-app"
  port                 = var.app_port
  protocol             = "HTTP"
  vpc_id               = aws_vpc.main.id
  deregistration_delay = 30

  health_check {
    path                = var.health_check_path
    matcher             = "200"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

############################################
# Certificate
############################################
resource "aws_acm_certificate" "api" {
  count             = var.enable_alb && var.acm_certificate_arn == "" ? 1 : 0
  domain_name       = var.api_domain
  validation_method = "DNS"
  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "api_validation" {
  for_each = var.enable_alb && var.acm_certificate_arn == "" && var.route53_zone_id != "" ? {
    for o in aws_acm_certificate.api[0].domain_validation_options : o.domain_name => o
  } : {}
  zone_id = var.route53_zone_id
  name    = each.value.resource_record_name
  type    = each.value.resource_record_type
  records = [each.value.resource_record_value]
  ttl     = 60
}

resource "aws_acm_certificate_validation" "api" {
  count                   = var.enable_alb && var.acm_certificate_arn == "" && var.route53_zone_id != "" ? 1 : 0
  certificate_arn         = aws_acm_certificate.api[0].arn
  validation_record_fqdns = [for r in aws_route53_record.api_validation : r.fqdn]
}

locals {
  alb_certificate_arn = var.acm_certificate_arn != "" ? var.acm_certificate_arn : (
    var.enable_alb ? (var.route53_zone_id != "" ? aws_acm_certificate_validation.api[0].certificate_arn : aws_acm_certificate.api[0].arn) : ""
  )
}

############################################
# Listeners
############################################
resource "aws_lb_listener" "https" {
  count             = var.enable_alb ? 1 : 0
  load_balancer_arn = aws_lb.app[0].arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = local.alb_certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app[0].arn
  }
}

resource "aws_lb_listener" "http_redirect" {
  count             = var.enable_alb ? 1 : 0
  load_balancer_arn = aws_lb.app[0].arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}
