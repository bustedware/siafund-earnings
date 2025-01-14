# deploy instructions
1. cd siafund
2. npm install
3. cd ../iac
4. create terraform.tfvars with the following variables
    - kraken_api_key="***"
    - kraken_api_secret="***"
    - access_key="***"
    - secret_key="***"
    - domain_name="www.example.com"
    - mdbserver="your.mongodbserver.com"
4. terraform init
5. terraform apply