import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';

import { VOLUME_SUPPORTED_DEVICES, VOLUME_LEVEL_MIN, VOLUME_LEVEL_MAX } from './settings';
import { RaumfeldRadioPlatform } from './platform';


export class RaumfeldRadioAccessory {
  private servicesByRendererUDN = new Map<string, Service>();

  constructor(
    private readonly platform: RaumfeldRadioPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Teufel');

    this.accessory.context.room.renderer.forEach(renderer => {
      const rendererUDN = renderer.$.udn;
      const rendererName = renderer.$.name;

      const accessoryType = this.hasVolumeControl(rendererUDN) ? this.platform.Service.Fan : this.platform.Service.Switch;
      const service = this.accessory.getService(rendererName) || this.accessory.addService(accessoryType, rendererName, rendererUDN);

      // Set the service name, this is what is displayed as the default name on the Home app
      const displayName = `${this.station.name} (${this.roomName})`;
      service.setCharacteristic(this.platform.Characteristic.Name, displayName);

      // Register handlers for the On/Off Characteristic
      service.getCharacteristic(this.platform.Characteristic.On)
        .onGet(this.getOn.bind(this, rendererUDN))
        .onSet(this.setOn.bind(this, rendererUDN));

      // Register handlers for the Volume Characteristic
      if (this.hasVolumeControl(rendererUDN)) {
        service.getCharacteristic(this.platform.Characteristic.RotationSpeed)
          .onGet(this.getVolume.bind(this, rendererUDN))
          .onSet(this.setVolume.bind(this, rendererUDN));
      }

      this.servicesByRendererUDN.set(rendererUDN, service);

      const updateHandler = (newZoneUDN: string, newRendererUDN: string, newStation: any) => {
        if (this.zoneUDN === newZoneUDN && this.station.name !== newStation.name) {
          this.deactivate(newRendererUDN);
        }
      };

      this.platform.updateHandlers.push(updateHandler);
    });
  }

  async setOn(rendererUDN: string, value: CharacteristicValue) {
    // Workaround: When setting the volume, the this function is called again
    // and leads to the device being displayed as turned off in the Home app.
    if (await this.getOn(rendererUDN) && value) {
      return Promise.resolve();
    }

    if (value) {
      await this.platform.connectToRoomsIfNeeded();

      if (!this.platform.powerStateOn(this.roomName)) {
        this.platform.log.debug(`Turn on device in ${this.roomName}`);
        await this.mediaRenderer(rendererUDN).leaveStandby();
        await new Promise(f => setTimeout(f, 3000));
      }

      this.platform.log.debug(`Change to new station URI for ${this.station.name}`);
      await this.virtualMediaRenderer.loadUri(this.station.streamURL, false, false);
      this.platform.log.debug(`Changed station URI for ${this.station.name}`);
    }

    this.platform.onChangeHandler(this.zoneUDN, rendererUDN, this.station, value);
  }

  async getOn(rendererUDN: string): Promise<CharacteristicValue> {
    return this.platform.stationStatus(this.station, this.roomName, this.zoneUDN);
  }

  async setVolume(rendererUDN: string, value: CharacteristicValue) {
    const volume = this.transformVolume(value as number, 0, 100, VOLUME_LEVEL_MIN, VOLUME_LEVEL_MAX);
    this.mediaRenderer(rendererUDN).setVolume(volume);
  }

  async getVolume(rendererUDN: string): Promise<CharacteristicValue> {
    const rawVolume = await this.mediaRenderer(rendererUDN).getVolume();
    return this.transformVolume(rawVolume, VOLUME_LEVEL_MIN, VOLUME_LEVEL_MAX, 0, 100);
  }

  transformVolume(input: number, inputMin: number, inputMax: number, outputMin: number, outputMax: number): CharacteristicValue {
    const clampedInput = Math.max(inputMin, Math.min(input as number, inputMax));
    const slope = (outputMax - outputMin) / (inputMax - inputMin);
    const output = outputMin + slope * (clampedInput - inputMin);
    return Math.round(output) as CharacteristicValue;
  }

  deactivate(rendererUDN: string) {
    const service = this.servicesByRendererUDN.get(rendererUDN);
    service?.getCharacteristic(this.platform.Characteristic.On)
      .updateValue(false);
  }

  modelName(rendererUDN: string): string {
    return this.mediaRenderer(rendererUDN)?.upnpClient.deviceDescription.modelName || '';
  }

  get zoneUDN(): string {
    return this.accessory.context.zone?.$.udn;
  }

  get roomUDN(): string {
    return this.accessory.context.room?.$.udn;
  }

  get roomName(): string {
    return this.accessory.context.room?.$.name;
  }

  get station(): any {
    return this.accessory.context.station;
  }

  mediaRenderer(rendererUDN: string): any {
    return this.platform.mediaRenderer(rendererUDN);
  }

  get virtualMediaRenderer(): any {
    return this.platform.virtualMediaRenderer(this.zoneUDN);
  }

  hasVolumeControl(rendererUDN: string): boolean {
    return VOLUME_SUPPORTED_DEVICES.includes(this.modelName(rendererUDN));
  }

}
