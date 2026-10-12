import querystring from 'querystring';
import crypto from 'crypto';
import axios from 'axios';

function getKrakenSignature(urlpath, data, secret) {
  const postdata = querystring.stringify(data);
  const encoded = Buffer.from(data.nonce + postdata);
  const message = Buffer.concat([
    Buffer.from(urlpath),
    crypto.createHash('sha256').update(encoded).digest()
  ]);

  const mac = crypto.createHmac('sha512', Buffer.from(secret, 'base64')).update(message).digest('base64');
  return mac;
}

async function krakenRequest(uriPath, data, apiKey, apiSec) {
  const headers = {
    'API-Key': process.env.kraken_api_key,
    'API-Sign': getKrakenSignature(uriPath, data, process.env.kraken_api_secret)
  };

  try {
    const response = await axios.post(`https://api.kraken.com${uriPath}`, querystring.stringify(data), { headers });
    return response.data;
  } catch (error) {
    console.error('Error making request:', error);
    throw error;
  }
}

export async function getKrakenPrice(pair="SCUSD") {
  const uriPath = `/0/public/Ticker?pair=${pair}`;
  const data = { nonce: new Date().getTime() * 1000 };
  return await krakenRequest(uriPath, data);
}