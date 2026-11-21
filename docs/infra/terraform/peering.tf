# Peering between this VPC and the default VPC, where the production RDS stays during the move (see AWS_NETWORK_PLAN.md).
# Off by default. Everything that already exists in the default VPC is READ with data sources and only ever receives
# ONE added route and ONE added rule. There is no aws_route_table, aws_security_group or aws_vpc resource for the
# default VPC here, on purpose: Terraform would otherwise take it over (and could change or destroy it).

locals {
  peer = var.peer_default_vpc ? 1 : 0
}

data "aws_vpc" "default" {
  count   = local.peer
  default = true
}

# The route table the database's subnets use. Default: the default VPC's main table.
data "aws_route_table" "db" {
  count          = local.peer
  vpc_id         = data.aws_vpc.default[0].id
  route_table_id = var.peer_db_route_table_id != "" ? var.peer_db_route_table_id : null

  dynamic "filter" {
    for_each = var.peer_db_route_table_id == "" ? [1] : []
    content {
      name   = "association.main"
      values = ["true"]
    }
  }
}

# Same account and same region, so the connection accepts itself.
resource "aws_vpc_peering_connection" "default" {
  count       = local.peer
  vpc_id      = aws_vpc.main.id
  peer_vpc_id = data.aws_vpc.default[0].id
  auto_accept = true
  tags        = { Name = "${local.name}-to-default-vpc" }

  lifecycle {
    precondition {
      condition     = var.vpc_cidr != data.aws_vpc.default[0].cidr_block
      error_message = "vpc_cidr overlaps the default VPC. Peering needs two different ranges."
    }
    precondition {
      condition     = var.peer_db_security_group_id != ""
      error_message = "peer_default_vpc needs peer_db_security_group_id (the existing database security group)."
    }
  }
}

# Lets the database's public host name resolve to its private address from this VPC, and the other way round.
resource "aws_vpc_peering_connection_options" "default" {
  count                     = local.peer
  vpc_peering_connection_id = aws_vpc_peering_connection.default[0].id

  requester {
    allow_remote_vpc_dns_resolution = true
  }
  accepter {
    allow_remote_vpc_dns_resolution = true
  }
}

# New VPC -> default VPC. The backend runs in the public tier in direct mode and in the app tier behind an ALB.
resource "aws_route" "peer_from_public" {
  count                     = local.peer
  route_table_id            = aws_route_table.public.id
  destination_cidr_block    = data.aws_vpc.default[0].cidr_block
  vpc_peering_connection_id = aws_vpc_peering_connection.default[0].id
}

resource "aws_route" "peer_from_app" {
  count                     = local.peer == 1 ? var.az_count : 0
  route_table_id            = aws_route_table.app[count.index].id
  destination_cidr_block    = data.aws_vpc.default[0].cidr_block
  vpc_peering_connection_id = aws_vpc_peering_connection.default[0].id
}

# Default VPC -> new VPC: the replies from the database. ONE route added to the existing table.
resource "aws_route" "peer_to_new_vpc" {
  count                     = local.peer
  route_table_id            = data.aws_route_table.db[0].id
  destination_cidr_block    = var.vpc_cidr
  vpc_peering_connection_id = aws_vpc_peering_connection.default[0].id
}

# ONE rule added to the existing database security group: the database port from the new app group only.
resource "aws_vpc_security_group_ingress_rule" "db_from_new_vpc_app" {
  count                        = local.peer
  security_group_id            = var.peer_db_security_group_id
  description                  = "NASA new VPC backend"
  ip_protocol                  = "tcp"
  from_port                    = var.db_port
  to_port                      = var.db_port
  referenced_security_group_id = aws_security_group.app.id

  # The cross-VPC group reference only works once the connection is active and the routes exist.
  depends_on = [aws_vpc_peering_connection_options.default, aws_route.peer_to_new_vpc]
}
