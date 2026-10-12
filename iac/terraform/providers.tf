terraform {
  required_providers {
    mongodbatlas = {
      source = "mongodb/mongodbatlas"
      version = "2.2.0"
    }
  }
}

provider "aws" {
  region = "us-east-1"
  access_key = var.access_key
  secret_key = var.secret_key
}

provider "mongodbatlas" {
  public_key = var.mongodbatlas_pubkey
  private_key = var.mongodbatlas_privkey
}
