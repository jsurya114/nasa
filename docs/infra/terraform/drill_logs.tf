############################################
# Private bucket for the server logs saved before the recovery drill (production only)
############################################
# Why: the app and Caddy logs live only in the server's journal, and an instance refresh (the recovery drill) deletes them.
# This bucket holds one compressed copy for a limited time. Nothing writes to it automatically: the server has no access to it.
# A person uploads the file through a pre-signed PUT link that expires within 15 minutes (never posted, never kept on a laptop).
# Used for nothing else. Not the state bucket, not the release bucket. See docs/infra/DRILL_LOG_SAVE.md.
resource "aws_s3_bucket" "drill_logs" {
  count  = local.staging ? 0 : 1
  bucket = "${local.name}-drill-logs-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "drill_logs" {
  count                   = local.staging ? 0 : 1
  bucket                  = aws_s3_bucket.drill_logs[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "drill_logs" {
  count  = local.staging ? 0 : 1
  bucket = aws_s3_bucket.drill_logs[0].id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# The saved file is deleted this many days after it is uploaded (and unfinished uploads after 1 day).
resource "aws_s3_bucket_lifecycle_configuration" "drill_logs" {
  count  = local.staging ? 0 : 1
  bucket = aws_s3_bucket.drill_logs[0].id
  rule {
    id     = "expire-saved-logs"
    status = "Enabled"
    filter {}
    expiration {
      days = var.drill_log_retention_days
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

# Only encrypted connections.
data "aws_iam_policy_document" "drill_logs_tls_only" {
  count = local.staging ? 0 : 1
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.drill_logs[0].arn, "${aws_s3_bucket.drill_logs[0].arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "drill_logs" {
  count  = local.staging ? 0 : 1
  bucket = aws_s3_bucket.drill_logs[0].id
  policy = data.aws_iam_policy_document.drill_logs_tls_only[0].json
  # The public-access block and the policy are written one after the other (S3 refuses parallel changes to both).
  depends_on = [aws_s3_bucket_public_access_block.drill_logs]
}
