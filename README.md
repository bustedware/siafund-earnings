# SiaFund Earnings

A web dashboard for tracking Siafund earnings on the Sia network.

**Website:** https://siafunds.org

Funded through a grant from the [Sia Foundation](https://sia.tech/grants).

## Features

- Hourly and daily earnings charts for the past 30 days
- Average hourly and daily earnings in Siacoin (SC)
- Current Siacoin price
- USD equivalent of earnings over the past 30 days
- Background data collection and historical backfilling
- Cached earnings data to reduce repeated database queries

## Technology

- Node.js and Express
- EJS templates
- Highcharts
- MongoDB
- Python for historical data backfilling
- Terraform for AWS infrastructure

## How It Works

The data collection process reads the cumulative Siafund claim value at
successive block heights. The difference between consecutive values is
divided by the total number of Siafunds to calculate earnings per Siafund.

Records are stored in MongoDB with their block height, timestamp, and
earnings amount. The backend aggregates these records into hourly and
daily totals for the dashboard.

The frontend requests the last 30 days of earnings from:

    GET /api/earnings?days=30

Charts display earnings in SC. The USD total uses the current Siacoin
price, rather than the historical price at the time each earning accrued.

## Local Development

Install the Node.js dependencies:

    npm install

Configure the environment variables required by the application in a
local `.env` file. Refer to the source code for the required variable
names and connection settings.

The application requires access to MongoDB and the external services
used for blockchain data and Siacoin pricing.

Use the scripts defined in `package.json` to start the application.
To list available scripts:

    npm run

Do not commit `.env` files, credentials, private keys, or database
connection strings containing passwords.

## Data Collection and Backfilling

The Python backfill script populates historical earnings records for
a selected range of block heights.

When backfilling:

- Initialize the previous cumulative claim value from the block
  immediately before the requested range.
- Preserve decimal precision when calculating and storing amounts.
- Avoid inserting duplicate records for the same block height.
- Store timestamps consistently in UTC.

A zero earnings amount is valid when the cumulative claim value does
not change between blocks.

## Earnings Cache

The backend caches aggregated earnings and refreshes them periodically.

An in-memory cache belongs to a single Node.js process and is cleared
when that process restarts. When running multiple application instances,
each instance maintains its own cache unless shared storage is used.

## Infrastructure

Terraform configuration is maintained in the `iac/` directory.

Review configuration values and the Terraform plan before applying
infrastructure changes:

    terraform init
    terraform plan
    terraform apply

AWS credentials and sensitive Terraform variable values should remain
outside version control.

## About Siafunds

Siafunds are revenue-sharing tokens associated with the Sia network.
This project provides visibility into historical earnings based on
collected blockchain data.

Displayed earnings are historical observations, not a guarantee of
future returns.

## Contributing

Issues and pull requests are welcome.

For bug reports, include the affected date range or block heights,
expected behavior, and relevant logs. Remove credentials and other
sensitive information before sharing.

## Support

You can support the site with a Bitcoin donation:

    3Ns7qu75QfEr4vhN3vo9A49bPVhJuRWDR9