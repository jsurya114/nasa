output "vpc_id" {
  value = aws_vpc.main.id
}

output "subnets" {
  value = {
    public = aws_subnet.public[*].id
    app    = aws_subnet.app[*].id
    data   = aws_subnet.data[*].id
  }
}

output "mode" {
  value = var.enable_alb ? "ALB in front, instances in private subnets, NAT on" : "direct: instance in a public subnet with an Elastic IP (cheapest)"
}

output "api_ip_for_dns" {
  description = "Direct mode: point the api_domain A record here."
  value       = local.direct ? aws_eip.direct[0].public_ip : null
}

output "alb_dns_name" {
  description = "ALB mode: point the api_domain CNAME/alias here."
  value       = var.enable_alb ? aws_lb.app[0].dns_name : null
}

output "acm_validation_records" {
  description = "ALB mode with no Route 53 zone: create these DNS records by hand so the certificate validates."
  value = var.enable_alb && var.acm_certificate_arn == "" && var.route53_zone_id == "" ? [
    for o in aws_acm_certificate.api[0].domain_validation_options : {
      name  = o.resource_record_name
      type  = o.resource_record_type
      value = o.resource_record_value
    }
  ] : []
}

output "artifact_bucket" {
  description = "Upload releases to s3://<bucket>/releases/backend-latest.tgz (see docs/infra/scripts/package-backend.sh)."
  value       = aws_s3_bucket.artifacts.bucket
}

output "ssm_parameter_path" {
  value = var.ssm_parameter_path
}

output "asg_name" {
  value = aws_autoscaling_group.app.name
}

output "alerts_topic_arn" {
  value = aws_sns_topic.alerts.arn
}

output "node_heap_mb" {
  description = "The Node heap limit the instances use (chosen from the instance size unless node_heap_mb is set)."
  value       = local.node_heap_mb
}

output "staging" {
  description = "Staging load-test helpers (null in prod)."
  value = local.staging ? {
    test_db_endpoint   = local.test_database ? aws_db_instance.test[0].address : null
    test_db_secret_arn = local.test_database ? aws_db_instance.test[0].master_user_secret[0].secret_arn : null
    load_generator_id  = local.load_generator ? aws_instance.load_generator[0].id : null
    load_generator_ip  = local.load_generator ? aws_instance.load_generator[0].private_ip : null
  } : null
}

output "peering_connection_id" {
  description = "VPC peering connection to the default VPC (null when peer_default_vpc is false)."
  value       = var.peer_default_vpc ? aws_vpc_peering_connection.default[0].id : null
}
