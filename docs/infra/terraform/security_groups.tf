############################################
# ALB (exists always; carries no traffic while the ALB is off)
############################################
resource "aws_security_group" "alb" {
  name        = "${local.name}-alb"
  description = "Public entry point: HTTPS from the internet"
  vpc_id      = aws_vpc.main.id
  tags        = { Name = "${local.name}-alb" }
}

resource "aws_vpc_security_group_ingress_rule" "alb_https" {
  security_group_id = aws_security_group.alb.id
  description       = "HTTPS from the internet"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_ingress_rule" "alb_http" {
  security_group_id = aws_security_group.alb.id
  description       = "HTTP from the internet (only redirects to HTTPS)"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_egress_rule" "alb_to_app" {
  security_group_id            = aws_security_group.alb.id
  description                  = "To the app instances"
  ip_protocol                  = "tcp"
  from_port                    = var.app_port
  to_port                      = var.app_port
  referenced_security_group_id = aws_security_group.app.id
}

############################################
# App instances
############################################
resource "aws_security_group" "app" {
  name        = "${local.name}-app"
  description = "Backend instances. No SSH: use SSM Session Manager."
  vpc_id      = aws_vpc.main.id
  tags        = { Name = "${local.name}-app" }
}

resource "aws_vpc_security_group_ingress_rule" "app_from_alb" {
  security_group_id            = aws_security_group.app.id
  description                  = "App port from the ALB only"
  ip_protocol                  = "tcp"
  from_port                    = var.app_port
  to_port                      = var.app_port
  referenced_security_group_id = aws_security_group.alb.id
}

# Direct mode only (ALB off): Caddy on the instance answers on 80 and 443, from public_ingress_cidrs (production: everyone).
locals {
  direct_ingress = local.direct ? { for pair in setproduct(var.public_ingress_cidrs, [80, 443]) : "${pair[0]}-${pair[1]}" => { cidr = pair[0], port = pair[1] } } : {}
}

resource "aws_vpc_security_group_ingress_rule" "app_direct" {
  for_each          = local.direct_ingress
  security_group_id = aws_security_group.app.id
  description       = each.value.port == 443 ? "Direct mode: HTTPS" : "Direct mode: HTTP (certificate challenge and redirect)"
  ip_protocol       = "tcp"
  from_port         = each.value.port
  to_port           = each.value.port
  cidr_ipv4         = each.value.cidr
}

# Staging: the load generator reaches the backend over the private network, by security group, not by address.
resource "aws_vpc_security_group_ingress_rule" "app_from_load_generator" {
  count                        = local.load_generator ? 1 : 0
  security_group_id            = aws_security_group.app.id
  description                  = "HTTPS from the staging load generator only"
  ip_protocol                  = "tcp"
  from_port                    = 443
  to_port                      = 443
  referenced_security_group_id = aws_security_group.load_generator[0].id
}

resource "aws_vpc_security_group_egress_rule" "app_all" {
  security_group_id = aws_security_group.app.id
  description       = "Outbound: Everee, QuickBooks, Cloudinary, Expo, Redis, database, package downloads"
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

############################################
# Data tier (placeholder for a future RDS / cache inside the VPC)
############################################
resource "aws_security_group" "data" {
  name        = "${local.name}-data"
  description = "Database tier: only the app instances may connect"
  vpc_id      = aws_vpc.main.id
  tags        = { Name = "${local.name}-data" }
}

resource "aws_vpc_security_group_ingress_rule" "data_from_app" {
  security_group_id            = aws_security_group.data.id
  description                  = "Database port from the app instances only"
  ip_protocol                  = "tcp"
  from_port                    = var.db_port
  to_port                      = var.db_port
  referenced_security_group_id = aws_security_group.app.id
}
