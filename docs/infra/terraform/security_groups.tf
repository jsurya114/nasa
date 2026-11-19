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

# Direct mode only (ALB off): Caddy on the instance answers the internet on 80 and 443.
resource "aws_vpc_security_group_ingress_rule" "app_direct_https" {
  count             = local.direct ? 1 : 0
  security_group_id = aws_security_group.app.id
  description       = "Direct mode: HTTPS from the internet"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_ingress_rule" "app_direct_http" {
  count             = local.direct ? 1 : 0
  security_group_id = aws_security_group.app.id
  description       = "Direct mode: HTTP (certificate challenge and redirect)"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  cidr_ipv4         = "0.0.0.0/0"
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
