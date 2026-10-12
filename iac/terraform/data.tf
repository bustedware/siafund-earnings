data "aws_caller_identity" "current" {}

data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "public_east1a_1b" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }

  filter {
    name   = "availability-zone"
    values = ["us-east-1a", "us-east-1b"]
  }
}

data "aws_lb_listener" "https" {
  arn = var.listener_arn
}

data "aws_security_group" "ecs_sg" {
  id = var.ecs_sg
}

data "aws_lb" "ecs_alb" {
  arn  = var.ecs_alb_arn
  name = var.ecs_alb_name
}

# create the hosted zone manually
data "aws_route53_zone" "production" {
  name         = var.appdomain
  private_zone = false
}
