// LAMBDA
variable "mdbserver" {}
resource "local_file" "config" {
  content = templatefile("../siafund/index.tftpl", {
    mdbserver = var.mdbserver
  })
  filename = "../siafund/index.mjs"
}

data "archive_file" "lambda" {
    type = "zip"
    source_dir = "../siafund"
    output_path = "../siafund.zip"
    excludes    = ["../siafund/index.tftpl"]
    depends_on = [
      local_file.config
    ]
}

# mkdir nodejs
# cd nodejs
# npm install aws4 aws-sdk axios querystring
# cd ..
# zip -r lambda_layer.zip nodejs/

resource "aws_lambda_layer_version" "lambda_layer" {
    filename = "../lambda_layer.zip"
    layer_name = "siafund_layer"
    compatible_runtimes = ["nodejs20.x"]
    source_code_hash = filebase64sha256("../lambda_layer.zip")
}

resource "aws_lambda_function" "lambda" {
    filename = "../siafund.zip"
    function_name = "siafund"
    role = aws_iam_role.lambda.arn
    handler       = "index.handler"
    source_code_hash = data.archive_file.lambda.output_base64sha256
    runtime       = "nodejs20.x"
    layers = [aws_lambda_layer_version.lambda_layer.arn]
    timeout = 120
}

resource "aws_secretsmanager_secret" "siafunds_secrets" {
    name = "siafunds_secrets"
}

variable "kraken_api_key" {}
variable "kraken_api_secret" {}

resource "aws_secretsmanager_secret_version" "siafunds_secrets" {
    secret_id = aws_secretsmanager_secret.siafunds_secrets.id
    secret_string = jsonencode({
        "apiKey": var.kraken_api_key,
        "apiSecret": var.kraken_api_secret,
    })
}

resource "aws_iam_role_policy" "sm_policy" {
  name = "sm_access_permissions"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = [
          "secretsmanager:GetSecretValue",
        ]
        Effect   = "Allow"
        Resource = "*"
      },
    ]
  })
}
