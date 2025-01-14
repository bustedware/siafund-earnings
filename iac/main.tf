terraform {
    required_providers {
        aws = {
            source = "hashicorp/aws"
            version = "5.41.0"
        }
    }
}

variable "access_key" {}
variable "secret_key" {}

provider "aws" {
    access_key = var.access_key
    secret_key = var.secret_key
}
