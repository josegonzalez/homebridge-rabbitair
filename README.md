# homebridge-rabbitair

A Homebridge plugin for Rabbit Air air purifiers (MinusA2, A3 and BioGS) that talks to them directly over your local network. It also ships a standalone TypeScript SDK for the same protocol.

- No cloud account and no extra software: the plugin uses Node's built-in networking and crypto. Its only runtime dependency is Homebridge's own settings UI library.
- Purifiers are found automatically with mDNS, including when their IP address changes.
- State is cached and refreshed in the background, so HomeKit reads never wait on the network.
- A settings page finds purifiers on the network, checks user keys and walks you through re-pairing when a key is out of date.

## What shows up in HomeKit

| Purifier feature | HomeKit | Notes |
|---|---|---|
| Power | Air Purifier: Active | |
| Auto and manual mode | Air Purifier: Target State | Pollen mode reads as manual |
| Fan speed | Air Purifier: Rotation Speed | Silent, Low, Medium, High and Turbo are 20%, 40%, 60%, 80% and 100%. Super silent, which the purifier picks on its own, reads as 1%. 0% turns the purifier off. |
| Purifying or idle | Air Purifier: Current State | Idle on models that report it |
| Pollen mode | Switch | MinusA2 and BioGS. Turning it off returns to auto. |
| Ionizer | Switch | |
| Mood light | Switch | On in any mood light mode except off |
| Display lights | Switch | On when the panel lights are on or automatic |
| Air quality | Air Quality Sensor | See [air quality](#air-quality) |
| Sensor errors | Air Quality Sensor: Status Fault | |
| Filter life | Filter Maintenance | Remaining life as a share of the purifier's own nominal filter life |
| Filter replacement | Filter Maintenance: Change Filter | |
| Filter reset | Filter Maintenance: Reset | Sets the remaining life back to the nominal life |
| Child lock | Air Purifier: Lock Physical Controls | Only models that report it, such as the A3. The MinusA2 does not. |
| Model, MAC address, firmware | Accessory information | |

Each optional service can be turned off per purifier, and services the purifier does not report are left out.

HomeKit has no matching controls for the sensor sensitivity, the shut-off timer, the hourly schedule, the mood light colors or the sleep state, so these are not exposed. They are all available through the [SDK](#sdk).

## Install

Search for "Rabbit Air" in the Homebridge UI plugins tab, or run:

```shell
npm install -g @josediazgonzalez/homebridge-rabbitair
```

Requires Homebridge 1.8 or newer and Node.js 22, 24 or 26. Homebridge and the purifiers must be on the same network, and mDNS (UDP port 5353) must not be blocked between them.

### Install from source

Run these on the machine that runs Homebridge, in the same place Homebridge installs its plugins. With a global npm install of Homebridge, that is `npm install -g`. With the official Homebridge apt package or Raspberry Pi image, open the terminal in the Homebridge UI and add `--prefix /var/lib/homebridge` instead of `-g`. Restart Homebridge afterwards.

From GitHub, which builds the plugin during the install and needs `git`:

```shell
npm install -g github:josegonzalez/homebridge-rabbitair
# or a specific release or branch
npm install -g github:josegonzalez/homebridge-rabbitair#v0.1.0
```

From a checkout, by building a package file and installing that. This also works for a Homebridge machine without `git` or internet access: copy the `.tgz` file over and install it there.

```shell
git clone https://github.com/josegonzalez/homebridge-rabbitair.git
cd homebridge-rabbitair
npm ci
npm run build
npm pack
npm install -g ./josediazgonzalez-homebridge-rabbitair-*.tgz
```

To go back to the published version, install `@josediazgonzalez/homebridge-rabbitair` from the Homebridge UI or with npm as usual.

## Setup

Open the plugin's settings in the Homebridge UI and click "Search the network". Each purifier that is not set up yet shows its MAC address and Thing ID. Click "Set up", give it a name and paste its user key. The plugin checks the key with the purifier before saving it.

To find the user key:

- **Rabbit Air 2 app:** tap the purifier, open the three-dot menu in the top right, choose "Rename" and tap the device name. The Thing ID and User key appear below it.
- **Older Rabbit Air app:** tap the purifier, tap "Edit", then quickly tap "Serial Number" several times until the device ID and user key appear. If you see "Tap for setup user key", tap it and follow the prompts.

If the purifier rejects a key that matches the app, the key saved on the purifier is probably out of date. Remove the purifier from the app, add it again, and use the new key. Re-pairing changes both the Thing ID and the user key, but not the MAC address, so the plugin keeps following the same purifier. "Check key" on a saved purifier runs the same check later.

### Manual configuration

```json
{
  "platform": "RabbitAirLocal",
  "devices": [
    {
      "name": "Living Room Purifier",
      "token": "0123456789ABCDEF0123456789ABCDEF",
      "mac": "8C:AA:B5:AA:E3:A4"
    },
    {
      "name": "Kitchen Purifier",
      "token": "0123456789ABCDEF0123456789ABCDEF",
      "host": "192.168.1.189",
      "ionizerSwitch": false
    }
  ]
}
```

| Option | Default | Description |
|---|---|---|
| `devices[].name` | | Name shown in HomeKit |
| `devices[].token` | | The 32 character user key |
| `devices[].mac` | | MAC address. Recommended: the plugin finds the purifier with it and follows IP address changes. Logged at startup for purifiers that are not configured. |
| `devices[].host` | | IP address or hostname, optionally with a port. Optional when `mac` is set. |
| `devices[].transport` | `udp` | `udp` or `tcp` |
| `devices[].airQualitySensor`, `filterMaintenance`, `pollenModeSwitch`, `ionizerSwitch`, `moodLightSwitch`, `displayLightsSwitch`, `childLock` | `true` | Turn individual services off |
| `pollInterval` | `15` | Seconds between background state reads (minimum 5) |
| `discovery` | `true` | Use mDNS to find purifiers and follow address changes |
| `airQualityScale` | `higherIsBetter` | Which way the purifier's air quality value runs |

### Air quality

The purifier reports air quality as a number from 1 to 4. The protocol names these levels "low" to "highest" but does not say whether a higher number means cleaner or dirtier air. The plugin assumes higher is cleaner. If HomeKit shows poor air while the light on the purifier shows clean air, set `airQualityScale` to `higherIsWorse`.

## How it talks to the purifier

Each purifier gets one long-lived connection on UDP port 9009, and requests are sent one at a time. Every message is encrypted with AES-128-CBC using the user key, so a wrong key gets no answer at all.

- **Reads:** the state is read every `pollInterval` seconds and cached. HomeKit reads are answered from the cache. Only changed values are pushed to HomeKit.
- **Writes:** changes that arrive together, such as power plus fan speed, or a burst of values while dragging a slider, are merged into one command. The cache is updated straight away, and the state is read once more 2 seconds later to pick up side effects. The purifier applies changes on a one-second cycle.
- **Failures:** after two failed reads in a row, HomeKit shows the purifier as not responding and the plugin looks it up again with mDNS in case its address changed. One failed read keeps serving the cached state.

## SDK

The protocol client can be used without Homebridge:

```ts
import { discover, Mode, RabbitAirClient, Speed } from '@josediazgonzalez/homebridge-rabbitair/sdk';

const [device] = await discover();
const client = new RabbitAirClient({ host: device.address, token: process.env.RABBITAIR_TOKEN! });

const state = await client.getState();
console.log(state.model, state.power, state.speed, state.quality);

await client.setState({ power: true, mode: Mode.Manual, speed: Speed.High });
client.close();
```

| Export | Description |
|---|---|
| `discover(options?)` | Finds purifiers with mDNS: Thing ID, address, port and MAC address |
| `findDevice(mac, options?)` | Finds one purifier by MAC address, returning as soon as it answers |
| `RabbitAirClient` | `getState()`, `getInfo()`, `setState(update)`, `command(cmd, data?)`, `setHost(host)`, `close()` |
| `State`, `Update`, `Info` | Typed state, settable fields and device information |
| `Mode`, `Speed`, `Quality`, `Lights`, `Moodlight`, `Sensitivity`, `TimerMode`, `Model`, ... | Protocol values, with `enumName()` to turn a value into its name |
| `TimeoutError`, `ProtocolError`, `InvalidTokenError` | Errors |

`setState` validates values before sending them, sends only the fields you pass, and throws a `RangeError` for values the purifier does not accept, such as setting the super silent speed.

## Troubleshooting

- **Not responding:** check that Homebridge can reach the purifier on UDP port 9009, and that the user key is current (use "Check key" in the settings).
- **Not found by discovery:** mDNS can be blocked by Docker bridge networking, VLANs or some mesh Wi-Fi systems. Run Homebridge with host networking, or set `host` for each purifier.
- **Debug logging:** start Homebridge with `-D` to see every request and poll.

## Development

```shell
npm install
npm test
```

Tests use Node's built-in test runner against an emulated purifier and the real HomeKit (HAP) classes. See [RELEASING.md](RELEASING.md) for how releases are published.

To try a working copy, including its settings page, in a throwaway Homebridge with the Homebridge UI:

```shell
npm run dev:ui
```

It installs Homebridge and the Homebridge UI into `tmp/dev-homebridge` (outside the plugin's own dependencies), links this checkout as a plugin, and starts both. The UI only listens on `127.0.0.1` and keeps its login: on first start, open the printed URL and create an admin account. Set the plugin up through its settings page like a user would. The configuration and the UI account are kept between runs; delete `tmp/dev-homebridge` to start over. Restarting Homebridge from the UI does not work in this setup, so stop and rerun the script instead. Set `DEV_UI_PORT` to use another port than 8592.

## License

Apache-2.0. The protocol is based on [python-rabbitair](https://github.com/rabbit-air/python-rabbitair). This project is not affiliated with Rabbit Air.
