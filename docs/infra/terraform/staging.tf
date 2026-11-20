# Staging-only load-test helpers. Each resource has count 0 unless environment = "staging" and its switch is on
# (variables.tf refuses the switches in prod). Nothing here touches, reads or imports a production resource.

############################################
# Isolated test database: its own RDS instance (separate compute from production), synthetic data only
############################################
resource "aws_db_subnet_group" "test" {
  count      = local.test_database ? 1 : 0
  name       = "${local.name}-test-db"
  subnet_ids = aws_subnet.data[*].id
  tags       = { Name = "${local.name}-test-db" }
}

resource "aws_db_instance" "test" {
  count                  = local.test_database ? 1 : 0
  identifier             = "${local.name}-loadtest-db"
  engine                 = "postgres"
  engine_version         = var.test_db_engine_version
  instance_class         = var.test_db_instance_class
  allocated_storage      = 20
  storage_type           = "gp3"
  storage_encrypted      = true
  db_name                = "nasa_staging"
  username               = "nasa_staging"
  port                   = var.db_port
  db_subnet_group_name   = aws_db_subnet_group.test[0].name
  vpc_security_group_ids = [aws_security_group.data.id]
  availability_zone      = local.azs[0] # same AZ as the staging backend (app_single_az)
  publicly_accessible    = false
  multi_az               = false

  # The password is created and kept by RDS in Secrets Manager; it never passes through Terraform state.
  manage_master_user_password = true

  # Throwaway: no backups, no final snapshot, no protection, so `terraform destroy` removes it completely.
  backup_retention_period      = 0
  skip_final_snapshot          = true
  deletion_protection          = false
  delete_automated_backups     = true
  performance_insights_enabled = false
  monitoring_interval          = 0
  auto_minor_version_upgrade   = false
  apply_immediately            = true

  tags = { Name = "${local.name}-loadtest-db", Purpose = "loadtest-synthetic-data" }
}

############################################
# Load generator: a separate instance in the second AZ, reachable only through SSM (no inbound rules at all)
############################################
resource "aws_security_group" "load_generator" {
  count       = local.load_generator ? 1 : 0
  name        = "${local.name}-load-generator"
  description = "Staging load generator: no inbound, outbound to the internet for packages and to the backend"
  vpc_id      = aws_vpc.main.id
  tags        = { Name = "${local.name}-load-generator" }
}

resource "aws_vpc_security_group_egress_rule" "load_generator_all" {
  count             = local.load_generator ? 1 : 0
  security_group_id = aws_security_group.load_generator[0].id
  description       = "Outbound: the staging backend, package downloads, SSM"
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_iam_role" "load_generator" {
  count                = local.load_generator ? 1 : 0
  name                 = "${local.name}-load-generator"
  permissions_boundary = var.role_permissions_boundary_arn
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "ec2.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}

resource "aws_iam_role_policy_attachment" "load_generator_ssm" {
  count      = local.load_generator ? 1 : 0
  role       = aws_iam_role.load_generator[0].name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

# Reads the runner bundle and writes results, under loadtest/ in the staging artifacts bucket. Nothing else.
resource "aws_iam_role_policy" "load_generator" {
  count = local.load_generator ? 1 : 0
  name  = "loadtest-bucket"
  role  = aws_iam_role.load_generator[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["s3:GetObject"], Resource = "${aws_s3_bucket.artifacts.arn}/loadtest/*" },
      { Effect = "Allow", Action = ["s3:PutObject"], Resource = "${aws_s3_bucket.artifacts.arn}/loadtest/results/*" },
    ]
  })
}

resource "aws_iam_instance_profile" "load_generator" {
  count = local.load_generator ? 1 : 0
  name  = "${local.name}-load-generator"
  role  = aws_iam_role.load_generator[0].name
}

resource "aws_instance" "load_generator" {
  count                       = local.load_generator ? 1 : 0
  ami                         = data.aws_ssm_parameter.ami.value
  instance_type               = var.load_generator_instance_type
  subnet_id                   = aws_subnet.public[1].id # the second AZ; the backend stays in the first
  vpc_security_group_ids      = [aws_security_group.load_generator[0].id]
  associate_public_ip_address = true # no NAT: package downloads and SSM go out directly
  iam_instance_profile        = aws_iam_instance_profile.load_generator[0].name
  monitoring                  = var.detailed_monitoring

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  root_block_device {
    volume_size           = 8
    volume_type           = "gp3"
    encrypted             = true
    delete_on_termination = true
  }

  user_data = <<-EOT
    #!/bin/bash
    set -euo pipefail
    dnf install -y nodejs${var.node_major} nodejs${var.node_major}-npm
    command -v node >/dev/null || ln -sf /usr/bin/node-${var.node_major} /usr/local/bin/node
    node --version
    echo "load generator ready"
  EOT

  tags = { Name = "${local.name}-load-generator", Purpose = "loadtest" }
}
