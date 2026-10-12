resource "aws_ecs_cluster" "production" {
  name = "${lower(var.appnameproper)}-cluster"
}

# iam
resource "aws_iam_role" "ecs_task_execution" {
  name = "${lower(var.appnameproper)}_ecs_execution"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_execution_secrets_access" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/SecretsManagerReadWrite"
}

resource "aws_iam_role_policy_attachment" "ecs_execution_logs_and_ecr" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role" "ecs_task_role" {
  name = "${lower(var.appnameproper)}_ecs_task"

  assume_role_policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Effect = "Allow",
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        },
        Action = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy" "allow_s3_sts_ses_for" {
  name = "${lower(var.appnameproper)}_allow_s3_sts_ses"
  role = aws_iam_role.ecs_task_role.name # Change to your actual ECS role if different

  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Effect = "Allow",
        Action = "sts:GetCallerIdentity",
        Resource = "*"
      }
    ]
  })
}

resource "aws_lb_target_group" "production" {
  name        = "${lower(var.appnameproper)}"
  port        = 80
  protocol    = "HTTP"
  vpc_id      = data.aws_vpc.default.id
  target_type = "ip"
}

resource "aws_lb_listener_rule" "production" {
  listener_arn = data.aws_lb_listener.https.arn
  priority     = 8

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.production.arn
  }

  condition {
    host_header {
      values = [var.domain]
    }
  }
}

resource "aws_lb_listener_rule" "production_apex_redirect" {
  listener_arn = data.aws_lb_listener.https.arn
  priority     = 7

  action {
    type = "redirect"

    redirect {
      protocol    = "HTTPS"
      host        = var.domain
      path        = "/#{path}"
      query       = "#{query}"
      status_code = "HTTP_301"
    }
  }

  condition {
    host_header {
      values = [var.appdomain]
    }
  }
}

# production cert
resource "aws_acm_certificate" "production" {
  domain_name = var.appdomain

  subject_alternative_names = [
    "www.${var.appdomain}"
  ]

  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "production_certificate_validation" {
  for_each = {
    for option in aws_acm_certificate.production.domain_validation_options :
    option.domain_name => {
      name   = option.resource_record_name
      type   = option.resource_record_type
      record = option.resource_record_value
    }
  }

  zone_id = data.aws_route53_zone.production.zone_id
  name    = each.value.name
  type    = each.value.type
  ttl     = 300
  records = [each.value.record]
}

resource "aws_acm_certificate_validation" "production" {
  certificate_arn = aws_acm_certificate.production.arn

  validation_record_fqdns = [
    for record in aws_route53_record.production_certificate_validation :
    record.fqdn
  ]
}

resource "aws_route53_record" "production_apex" {
  zone_id = data.aws_route53_zone.production.zone_id
  name    = var.appdomain
  type    = "A"

  alias {
    name                   = data.aws_lb.ecs_alb.dns_name
    zone_id                = data.aws_lb.ecs_alb.zone_id
    evaluate_target_health = true
  }
}

resource "aws_route53_record" "production_www" {
  zone_id = data.aws_route53_zone.production.zone_id
  name    = "www.${var.appdomain}"
  type    = "A"

  alias {
    name                   = data.aws_lb.ecs_alb.dns_name
    zone_id                = data.aws_lb.ecs_alb.zone_id
    evaluate_target_health = true
  }
}

resource "aws_lb_listener_certificate" "production" {
  listener_arn = data.aws_lb_listener.https.arn
  certificate_arn = aws_acm_certificate_validation.production.certificate_arn
}

# ecs (created manually/doesn't matter)
# resource "aws_ecr_repository" "ecr_repo" {
#   name                 = "${lower(var.appnameproper)}"
#   image_tag_mutability = "MUTABLE"

#   image_scanning_configuration {
#     scan_on_push = true
#   }
# }

resource "aws_ecs_service" "production" {
  name            = "${lower(var.appnameproper)}-service"
  cluster         = aws_ecs_cluster.production.id
  task_definition = aws_ecs_task_definition.production.arn
  desired_count   = 1
  launch_type     = "FARGATE"
  enable_execute_command = true

  network_configuration {
    subnets          = data.aws_subnets.public_east1a_1b.ids
    security_groups  = [data.aws_security_group.ecs_sg.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.production.arn
    container_name   = "${lower(var.appnameproper)}"
    container_port   = 80
  }
}

resource "aws_ecs_task_definition" "production" {
  family                   = "${lower(var.appnameproper)}-task"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  memory                   = "512"
  cpu                      = "256"
  task_role_arn            = aws_iam_role.ecs_task_role.arn

  container_definitions = jsonencode([
    {
      healthCheck = {
        command     = ["CMD-SHELL", "wget -q --spider http://localhost/healthcheck || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 10
      }
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = "/ecs/${lower(var.appnameproper)}"
          awslogs-region        = "us-east-1"
          awslogs-stream-prefix = "ecs"
        }
      }
      name      = "${lower(var.appnameproper)}"
      image     = "${data.aws_caller_identity.current.account_id}.dkr.ecr.us-east-1.amazonaws.com/${lower(var.appnameproper)}:latest"
      cpu       = 256
      memory    = 512
      essential = true
      environment = [
        { name = "snapenv", value = var.snapenv },
        { name = "mdbhost", value = var.mdbhost },
        { name = "mdbauth", value = var.mdbauth },
        { name = "databasename", value = var.databasename },
      ]
      "secrets": [
        { "name": "kraken_api_key", "valueFrom": resource.aws_secretsmanager_secret.kraken_api_key.arn },
        { "name": "kraken_api_secret", "valueFrom": resource.aws_secretsmanager_secret.kraken_api_secret.arn },
      ]
      portMappings = [
        {
          containerPort = 80
          hostPort      = 80
        }
      ]
    }
  ])
}

# database user
resource "mongodbatlas_database_user" "production" {
  username           = aws_iam_role.ecs_task_role.arn

  project_id         = var.mongodbatlas_project_id
  auth_database_name = "$external"
  aws_iam_type       = "ROLE"

  roles {
    role_name     = "atlasAdmin"
    database_name = "admin"
  }
}

# cloudwatch
resource "aws_cloudwatch_log_group" "production" {
  name              = "/ecs/${lower(var.appnameproper)}"
  retention_in_days = 1
}