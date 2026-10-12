#########################
# kraken_api_key
resource "aws_secretsmanager_secret" "kraken_api_key" {
  name = "kraken_api_key"
}
resource "aws_secretsmanager_secret_version" "kraken_api_key" {
  secret_id = aws_secretsmanager_secret.kraken_api_key.id
  secret_string = var.kraken_api_key
}

#########################
# kraken_api_secret
resource "aws_secretsmanager_secret" "kraken_api_secret" {
  name = "kraken_api_secret"
}
resource "aws_secretsmanager_secret_version" "kraken_api_secret" {
  secret_id = aws_secretsmanager_secret.kraken_api_secret.id
  secret_string = var.kraken_api_secret
}
