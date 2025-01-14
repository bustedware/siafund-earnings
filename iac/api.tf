# API Gateway
resource "aws_api_gateway_rest_api" "api" {
  name = "siafunds"
}

data "aws_api_gateway_resource" "resource" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  path        = "/"
}

resource "aws_api_gateway_method" "method" {
  rest_api_id   = aws_api_gateway_rest_api.api.id
  resource_id   = data.aws_api_gateway_resource.resource.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "integration" {
  rest_api_id             = aws_api_gateway_rest_api.api.id
  resource_id             = data.aws_api_gateway_resource.resource.id
  http_method             = aws_api_gateway_method.method.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.lambda.invoke_arn
}

resource "aws_api_gateway_method_response" "status200" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_rest_api.api.root_resource_id
  http_method = aws_api_gateway_integration.integration.http_method
  status_code = "200"

  response_models = {
    "text/html" = "Empty"
  }
}

resource "aws_api_gateway_deployment" "deployment" {
    rest_api_id = aws_api_gateway_rest_api.api.id

    triggers = {
        redeployment = sha1(jsonencode(aws_api_gateway_rest_api.api.body))
    }

    lifecycle {
        create_before_destroy = true
    }

    depends_on = [
        aws_api_gateway_method.method,
        aws_api_gateway_integration.integration
    ]
}

resource "aws_api_gateway_stage" "stage" {
  deployment_id = aws_api_gateway_deployment.deployment.id
  rest_api_id   = aws_api_gateway_rest_api.api.id
  stage_name    = "terraform"
}

data "aws_caller_identity" "current" {}
variable "domain_name" {}

resource "aws_lambda_permission" "apigw_lambda" {
  statement_id  = "AllowExecutionFromAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.lambda.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn = "arn:aws:execute-api:us-east-1:${data.aws_caller_identity.current.account_id}:${aws_api_gateway_rest_api.api.id}/*/${aws_api_gateway_method.method.http_method}${data.aws_api_gateway_resource.resource.path}"
}

# DNS

resource "aws_acm_certificate" "siafunds_cert" {
  domain_name       = var.domain_name
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_api_gateway_domain_name" "siafunds_domain" {
  regional_certificate_arn = aws_acm_certificate_validation.siafunds_cert.certificate_arn
  domain_name     = var.domain_name
  endpoint_configuration {
    types = ["REGIONAL"]
  }
}

resource "aws_api_gateway_base_path_mapping" "siafunds_domain_mapping" {
  api_id      = aws_api_gateway_rest_api.api.id
  stage_name  = aws_api_gateway_stage.stage.stage_name
  domain_name = aws_api_gateway_domain_name.siafunds_domain.domain_name
}

resource "aws_acm_certificate_validation" "siafunds_cert" {
  certificate_arn         = aws_acm_certificate.siafunds_cert.arn
}