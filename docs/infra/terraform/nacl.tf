# Network ACLs are a coarse, STATELESS second layer behind the security groups: return traffic must be allowed explicitly
# (ephemeral ports 1024-65535). They are strict on what may ENTER each tier. Outbound from the app tier stays open
# because the app talks to services with changing addresses (Everee, QuickBooks, Cloudinary, Expo, Redis, the database);
# the security groups and the absence of inbound rules are what protect it.

locals {
  backend_cidrs = local.direct ? local.public_cidrs : local.app_cidrs
  eph_from      = 1024
  eph_to        = 65535

  # protocol "6" = TCP, "-1" = all
  nacl_rules = merge(
    # ---------- public tier ----------
    {
      "public-in-100"  = { nacl = "public", egress = false, num = 100, proto = "6", cidr = "0.0.0.0/0", from = 80, to = 80 }
      "public-in-110"  = { nacl = "public", egress = false, num = 110, proto = "6", cidr = "0.0.0.0/0", from = 443, to = 443 }
      "public-in-120"  = { nacl = "public", egress = false, num = 120, proto = "6", cidr = "0.0.0.0/0", from = local.eph_from, to = local.eph_to }
      "public-out-100" = { nacl = "public", egress = true, num = 100, proto = "-1", cidr = "0.0.0.0/0", from = 0, to = 0 }
    },
    # the NAT gateway lives in the public tier and must accept everything the app tier sends through it
    { for i, c in local.app_cidrs : "public-in-${200 + i}" => { nacl = "public", egress = false, num = 200 + i, proto = "-1", cidr = c, from = 0, to = 0 } },

    # ---------- app tier ----------
    { for i, c in local.public_cidrs : "app-in-${100 + i}" => { nacl = "app", egress = false, num = 100 + i, proto = "6", cidr = c, from = var.app_port, to = var.app_port } },
    {
      "app-in-200"  = { nacl = "app", egress = false, num = 200, proto = "6", cidr = "0.0.0.0/0", from = local.eph_from, to = local.eph_to }
      "app-out-100" = { nacl = "app", egress = true, num = 100, proto = "-1", cidr = "0.0.0.0/0", from = 0, to = 0 }
    },

    # ---------- data tier (database) ----------
    # From wherever the backend runs: the app subnets behind an ALB, the public subnets in direct mode.
    { for i, c in local.backend_cidrs : "data-in-${100 + i}" => { nacl = "data", egress = false, num = 100 + i, proto = "6", cidr = c, from = var.db_port, to = var.db_port } },
    { for i, c in local.backend_cidrs : "data-out-${100 + i}" => { nacl = "data", egress = true, num = 100 + i, proto = "6", cidr = c, from = local.eph_from, to = local.eph_to } },
  )
}

resource "aws_network_acl" "tier" {
  for_each = {
    public = aws_subnet.public[*].id
    app    = aws_subnet.app[*].id
    data   = aws_subnet.data[*].id
  }
  vpc_id     = aws_vpc.main.id
  subnet_ids = each.value
  tags       = { Name = "${local.name}-${each.key}" }
}

resource "aws_network_acl_rule" "r" {
  for_each       = local.nacl_rules
  network_acl_id = aws_network_acl.tier[each.value.nacl].id
  rule_number    = each.value.num
  egress         = each.value.egress
  protocol       = each.value.proto
  rule_action    = "allow"
  cidr_block     = each.value.cidr
  from_port      = each.value.proto == "-1" ? null : each.value.from
  to_port        = each.value.proto == "-1" ? null : each.value.to
}
