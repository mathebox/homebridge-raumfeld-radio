import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';

import RaumkernelLib = require('node-raumkernel');
import path from 'path';

import { CharacteristicValue } from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { RaumfeldRadioAccessory } from './platformAccessory';


export class RaumfeldRadioPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  // this is used to track restored cached accessories
  public readonly accessories: PlatformAccessory[] = [];

  private raumkernel = new RaumkernelLib.Raumkernel();
  public updateHandlers: any[] = [];

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.log.debug('Finished initializing platform:', this.config.platform);

    // Initializing Raumfeld kernel
    this.raumkernel.createLogger(1, path.resolve(__dirname, '../logs'));

    if (this.config['hostIP']) {
      this.raumkernel.settings.raumfeldHost = this.config['hostIP'];
    }

    const templatePath = path.resolve(__dirname, '../node_modules/node-raumkernel/lib/setUriMetadata.template');
    this.raumkernel.settings.uriMetaDataTemplateFile = templatePath;

    this.raumkernel.init();

    this.log.debug('Raumfeld radio platform finished initializing!');

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', () => {
      this.raumkernel.on('systemReady', () => {
        this.discoverDevices();
      });

      this.raumkernel.on('mediaRendererRaumfeldVirtualRemoved', () => {
        this.log.debug('Turn off all stations');
        this.updateHandlers.forEach(handler => handler(undefined));
      });
    });
  }

  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);

    // add the restored accessory to the accessories cache so we can track if it has already been registered
    this.accessories.push(accessory);
  }

  discoverDevices() {
    const zoneConfiguration = this.raumkernel.managerDisposer.zoneManager.zoneConfiguration;

    for (const zone of zoneConfiguration.zoneConfig.zones) {
      for (const subzone of zone.zone) {
        for (const room of subzone.room) {
          for (const station of this.config.stations) {
            const excludedRooms = station.excludedRooms ?? [];
            if (!excludedRooms.includes(room?.$?.name)) {
              this.registerAccessory(subzone, room, station);
            }
          }
        }
      }
    }
  }

  registerAccessory(zone: any, room: any, station: any) {
    const uuid = this.api.hap.uuid.generate(`homebridge:raumfeld-radio:station:${station.name}:${room?.$?.udn}`);
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);
    let radioAccessory;

    if (existingAccessory) {
      this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);

      existingAccessory.context.station = station;
      existingAccessory.context.room = room;
      existingAccessory.context.zone = zone;

      radioAccessory = new RaumfeldRadioAccessory(this, existingAccessory);
    } else {
      const displayName = `${station.name} (${room?.$?.name})`;
      this.log.info('Adding new accessory:', displayName);
      const accessory = new this.api.platformAccessory(displayName, uuid);

      accessory.context.station = station;
      accessory.context.room = room;
      accessory.context.zone = zone;

      radioAccessory = new RaumfeldRadioAccessory(this, accessory);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }
  }

  async connectToRoomsIfNeeded() {
    const zoneConfiguration = this.raumkernel.managerDisposer.zoneManager.zoneConfiguration;

    if (zoneConfiguration === null) {
      this.log.error('No zone config found');
      throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }

    if (!zoneConfiguration.zoneConfig?.$?.numRooms) {
      this.log.error('No Raumfeld Zones found');
      throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }

    if (zoneConfiguration.zoneConfig.unassignedRooms) {
      const connectPromises = zoneConfiguration.zoneConfig.unassignedRooms.map(unassignedRooms => {
        unassignedRooms.room.map(room => {

          this.log.debug(`Found and use unassigned room: ${room.name}`);
          return this.raumkernel.managerDisposer.zoneManager.connectRoomToZone(room.udn, '');
        });
      }).reduce((result, value) => result.concat(value), []);

      return Promise.allSettled(connectPromises)
        .then(x => new Promise(resolve => setTimeout(resolve, 2000, x))); // delay
    } else {
      const zone = zoneConfiguration.zoneConfig.zones[0].zone[0];
      this.log.debug(`Use zone ${zone.$.udn} with ${zone.room.length} rooms`);
      return Promise.resolve();
    }
  }

  mediaRenderer(rendererUDN: string): any {
    return this.raumkernel.managerDisposer.deviceManager.getMediaRenderer(rendererUDN);
  }

  virtualMediaRenderer(zoneUDN: string): any {
    return this.raumkernel.managerDisposer.deviceManager.getVirtualMediaRenderer(zoneUDN);
  }

  powerStateOn(roomName: string): boolean {
    const zoneConfiguration = this.raumkernel.managerDisposer.zoneManager.zoneConfiguration;

    for (const zone of zoneConfiguration.zoneConfig.zones) {
      for (const subzone of zone.zone) {
        for (const room of subzone.room) {
          if (room?.$?.name === roomName) {
            return room?.$?.powerState === 'ACTIVE';
          }
        }
      }
    }

    return false;
  }

  async stationStatus(station: any, roomName: string, zoneUDN: string) {
    if (!this.connectedToZone) {
      this.log.debug(`Failing status for station '${station.name}': Not connected to zone`);
      return Promise.resolve(false);
    }

    if (!this.powerStateOn(roomName)) {
      this.log.debug(`Failing status for station '${station.name}' in ${roomName}: Device not powered on`);
      return Promise.resolve(false);
    }

    return this.virtualMediaRenderer(zoneUDN).getMediaInfo().then(data => {
      const isPlayingViaApp = data.CurrentURIMetaData.includes(`id=${station.ebrowseID}`);
      const stationStatus = (data.CurrentURI === station.streamURL || isPlayingViaApp);
      return stationStatus;
    });
  }

  connectedToZone(zoneUDN: string): boolean {
    const zoneConfiguration = this.raumkernel.managerDisposer.zoneManager.zoneConfiguration;

    for (const zone of zoneConfiguration.zoneConfig.zones) {
      for (const subzone of zone.zone) {
        if (subzone?.$?.udn === zoneUDN) {
          return true;
        }
      }
    }

    return false;
  }

  async onChangeHandler(zoneUDN: string, rendererUDN: string, newStation: any, value: CharacteristicValue) {
    if (value) {
      this.updateHandlers.forEach(handler => handler(zoneUDN, rendererUDN, newStation.name));
    } else {
      await this.connectToRoomsIfNeeded();
      this.log.debug('Turn off device');
      this.mediaRenderer(rendererUDN).enterManualStandby();
    }
  }

}
