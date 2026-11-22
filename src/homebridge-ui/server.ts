/**
 * Server side of the custom settings UI. The Homebridge UI runs this script
 * while the plugin settings are open; the page in public/index.html calls the
 * routes below with homebridge.request().
 */
import { HomebridgePluginUiServer } from '@homebridge/plugin-ui-utils';

import { discoverDevices, verifyDevice, type VerifyRequest } from './routes.js';

class RabbitAirUiServer extends HomebridgePluginUiServer {
  constructor() {
    super();
    this.onRequest('/discover', () => discoverDevices());
    this.onRequest('/verify', (body: VerifyRequest) => verifyDevice(body));
    this.ready();
  }
}

// Only start when run by the Homebridge UI, not when imported by tests.
if (process.send) {
  new RabbitAirUiServer();
}
