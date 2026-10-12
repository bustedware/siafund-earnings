import express from 'express'
import { getKrakenPrice } from '#infra/kraken'
const index_routes = express.Router()

index_routes.get('/', async function(req, res, next) {
    const price = await getKrakenPrice()
    return res.render('pages/index', {
        scPrice: price["result"]["SCUSD"]["o"]
    })
})

index_routes.get('/api/earnings', async function(req, res, next) {
    return res.json(globalThis.earningsCache)
});

index_routes.get('/healthcheck', async function (req, res) {
    res.json({ "status": "OK" });
});

export default index_routes