data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_caller_identity" "current" {}

locals {
  name           = "${var.project}-${var.environment}"
  azs            = slice(data.aws_availability_zones.available.names, 0, var.az_count)
  nat_enabled    = var.enable_nat_gateway || var.enable_alb
  direct         = !var.enable_alb
  staging        = var.environment == "staging"
  test_database  = local.staging && var.create_test_database
  load_generator = local.staging && var.create_load_generator

  # Address plan (see docs/infra/AWS_NETWORK_PLAN.md). Index = AZ number.
  public_cidrs = [for i in range(var.az_count) : cidrsubnet(var.vpc_cidr, 8, i)]      # 10.20.0.0/24, 10.20.1.0/24, 10.20.2.0/24
  app_cidrs    = [for i in range(var.az_count) : cidrsubnet(var.vpc_cidr, 8, 10 + i)] # 10.20.10.0/24 ...
  data_cidrs   = [for i in range(var.az_count) : cidrsubnet(var.vpc_cidr, 8, 20 + i)] # 10.20.20.0/24 ...
}

############################################
# VPC and internet gateway
############################################
resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = local.name }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = local.name }
}

# The default security group is emptied so nothing can use it by accident.
resource "aws_default_security_group" "default" {
  count  = local.staging ? 0 : 1 # staging's deployer may not retag an existing AWS-made resource, and nothing uses it
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${local.name}-default-unused" }
}

############################################
# Subnets: public (ALB, NAT, direct-mode instance), app (private), data (isolated)
############################################
resource "aws_subnet" "public" {
  count                   = var.az_count
  vpc_id                  = aws_vpc.main.id
  availability_zone       = local.azs[count.index]
  cidr_block              = local.public_cidrs[count.index]
  map_public_ip_on_launch = false
  tags                    = { Name = "${local.name}-public-${local.azs[count.index]}", Tier = "public" }
}

resource "aws_subnet" "app" {
  count             = var.az_count
  vpc_id            = aws_vpc.main.id
  availability_zone = local.azs[count.index]
  cidr_block        = local.app_cidrs[count.index]
  tags              = { Name = "${local.name}-app-${local.azs[count.index]}", Tier = "app" }
}

resource "aws_subnet" "data" {
  count             = var.az_count
  vpc_id            = aws_vpc.main.id
  availability_zone = local.azs[count.index]
  cidr_block        = local.data_cidrs[count.index]
  tags              = { Name = "${local.name}-data-${local.azs[count.index]}", Tier = "data" }
}

# Where the backend instances run: public subnets in direct mode (Elastic IP, no NAT), app subnets behind an ALB.
locals {
  backend_subnets = local.direct ? aws_subnet.public[*].id : aws_subnet.app[*].id
}

############################################
# NAT (only when needed)
############################################
locals {
  nat_count = local.nat_enabled ? (var.nat_per_az ? var.az_count : 1) : 0
}

resource "aws_eip" "nat" {
  count  = local.nat_count
  domain = "vpc"
  tags   = { Name = "${local.name}-nat-${count.index}" }
}

resource "aws_nat_gateway" "main" {
  count         = local.nat_count
  allocation_id = aws_eip.nat[count.index].id
  subnet_id     = aws_subnet.public[count.index].id
  tags          = { Name = "${local.name}-${count.index}" }
  depends_on    = [aws_internet_gateway.main]
}

############################################
# Route tables
############################################
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${local.name}-public" }
}

resource "aws_route" "public_internet" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.main.id
}

resource "aws_route_table_association" "public" {
  count          = var.az_count
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table" "app" {
  count  = var.az_count
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${local.name}-app-${local.azs[count.index]}" }
}

resource "aws_route" "app_nat" {
  count                  = local.nat_enabled ? var.az_count : 0
  route_table_id         = aws_route_table.app[count.index].id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.main[var.nat_per_az ? count.index : 0].id
}

resource "aws_route_table_association" "app" {
  count          = var.az_count
  subnet_id      = aws_subnet.app[count.index].id
  route_table_id = aws_route_table.app[count.index].id
}

# Data tier: no route to the internet at all.
resource "aws_route_table" "data" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${local.name}-data" }
}

resource "aws_route_table_association" "data" {
  count          = var.az_count
  subnet_id      = aws_subnet.data[count.index].id
  route_table_id = aws_route_table.data.id
}

############################################
# S3 gateway endpoint (free): release downloads and logs do not use the NAT
############################################
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.main.id
  service_name      = "com.amazonaws.${var.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = concat([aws_route_table.public.id], aws_route_table.app[*].id)
  tags              = { Name = "${local.name}-s3" }
}

############################################
# Flow logs (optional)
############################################
resource "aws_cloudwatch_log_group" "flow" {
  count             = var.enable_flow_logs ? 1 : 0
  name              = "/${var.project}/${var.environment}/vpc-flow"
  retention_in_days = 14
}

resource "aws_iam_role" "flow" {
  count                = var.enable_flow_logs ? 1 : 0
  name                 = "${local.name}-flow-logs"
  permissions_boundary = var.role_permissions_boundary_arn
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "vpc-flow-logs.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "flow" {
  count = var.enable_flow_logs ? 1 : 0
  name  = "write-logs"
  role  = aws_iam_role.flow[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["logs:CreateLogStream", "logs:PutLogEvents", "logs:DescribeLogStreams"]
      Resource = "${aws_cloudwatch_log_group.flow[0].arn}:*"
    }]
  })
}

resource "aws_flow_log" "vpc" {
  count           = var.enable_flow_logs ? 1 : 0
  vpc_id          = aws_vpc.main.id
  traffic_type    = "ALL"
  log_destination = aws_cloudwatch_log_group.flow[0].arn
  iam_role_arn    = aws_iam_role.flow[0].arn
}
