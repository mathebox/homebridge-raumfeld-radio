
var RaumkernelLib = require("node-raumkernel");
var path = require("path");

var PLUGIN_NAME = "homebridge-raumfeld-radio";
var PLATFORM_NAME = "RaumfeldRadio";

var hap;
var Accessory;

module.exports = function(api) {
    hap = api.hap;
    Accessory = api.platformAccessory;
    api.registerPlatform(PLATFORM_NAME, RaumfeldRadioPlatform);
};

function RaumfeldRadioPlatform(log, config, api) {
    this.log = log;
    this.api = api;

    this.zoneUDN = undefined;

    this.raumkernel = new RaumkernelLib.Raumkernel();
    this.stations = config["stations"];
    this.accessories = [];

    this.updateHandlers = [];

    var self = this;

    // Initializing Raumfeld kernel
    this.raumkernel.createLogger(1, path.resolve(__dirname, "../logs"));
    this.raumkernel.settings.raumfeldHost = config["hostIP"];
    this.raumkernel.settings.uriMetaDataTemplateFile = path.resolve(__dirname, "../node_modules/node-raumkernel/lib/setUriMetadata.template");
    this.raumkernel.init();

    log.debug("Raumfeld radio platform finished initializing!");

    this.api.on('didFinishLaunching', () => {
        self.raumkernel.on("systemReady", () => {

            var zoneConfiguration = self.raumkernel.managerDisposer.zoneManager.zoneConfiguration;
            var rooms = zoneConfiguration.zoneConfig.zones[0].zone[0].room;

            rooms.forEach(room => {
                self.stations.forEach(station => {
                    self.publishAccessory(room, station.name);
                });
            });

            // TODO: unassigned rooms (test via spotify)
        });

        self.raumkernel.on("mediaRendererRaumfeldVirtualRemoved", () => {
            self.log.debug("Turn off all stations");
            self.updateHandlers.forEach(handler => handler(undefined));
        });
    })    
}

RaumfeldRadioPlatform.prototype = {

    connectToRoomIfNeeded: function() {
        var zoneConfiguration = this.raumkernel.managerDisposer.zoneManager.zoneConfiguration;

        if (zoneConfiguration == null) {
            return Promise.reject("No zone config found");
        }

        if (!zoneConfiguration.zoneConfig.$.numRooms) {
            return Promise.reject("No Raumfeld Zones found");
        }

        if (zoneConfiguration.zoneConfig.unassignedRooms !== undefined) {
            var unassignedRooms = zoneConfiguration.zoneConfig.unassignedRooms[0].room;
            var connectPromises = unassignedRooms.map(room => {
                this.log.debug("Found and use unassigned room:", room.name);
                return this.raumkernel.managerDisposer.zoneManager.connectRoomToZone(room.udn, "");
            });
            
            return Promise.allSettled(connectPromises)
                .then(x => new Promise(resolve => setTimeout(resolve, 2000, x))); // delay
        } else {
            var zone = zoneConfiguration.zoneConfig.zones[0].zone[0];
            this.zoneUDN = zone.$.udn;
            this.log.debug("Use zone", zone.$.udn, "with", zone.room.length, "rooms");
            return Promise.resolve();
        }
    },

    get['virtualMediaRenderer']() {
        return this.raumkernel.managerDisposer.deviceManager.getVirtualMediaRenderer(this.zoneUDN);
    },

    mediaRenderer: function(roomName) {
        return this.raumkernel.managerDisposer.deviceManager.getMediaRenderer(roomName);
    },

    get['connectedToZone']() {
        var zoneConfiguration = this.raumkernel.managerDisposer.zoneManager.zoneConfiguration;
        var connected = zoneConfiguration.zoneConfig.unassignedRooms === undefined; // TODO

        if (connected) {
            this.zoneUDN = zoneConfiguration.zoneConfig.zones[0].zone[0].$.udn;
        }

        return connected;
    },

    powerStateOn: function(roomName) {
        var zoneConfiguration = this.raumkernel.managerDisposer.zoneManager.zoneConfiguration;
        var rooms = zoneConfiguration.zoneConfig.zones[0].zone[0].room;
        var room = rooms.filter(r => r.$.name == roomName)[0];
        return room.$.powerState == "ACTIVE";
    },

    station: function(accessory) {
        var stationName = accessory.displayName.split(" / ")[0]
        return this.stations.filter(station => station.name === stationName)[0];
    },

    roomName: function(accessory) {
        return accessory.displayName.split(" / ")[1];
    },

    stationStatus: function(station, roomName) { 
        if (!this.connectedToZone) {
            this.log.debug(`Fialing status for station '${station.name}': Not connected to zone`)
            return Promise.resolve(false);
        }

        if (!this.powerStateOn(roomName)) {
            this.log.debug(`Failing status for station '${station.name}': Device not powered on`)
            return Promise.resolve(false);
        }

        return this.virtualMediaRenderer.getMediaInfo().then(data => {
            var isPlayingViaApp = data.CurrentURIMetaData.includes("id=" + station.ebrowseID);
            var stationStatus = (data.CurrentURI == station.streamURL || isPlayingViaApp);
            return stationStatus
        });
    },

    configureAccessory: function(accessory) {
        var self = this;

        this.log("Configuring accessory %s", accessory.displayName);

        var station = this.station(accessory);
        var roomName = this.roomName(accessory);

        var switchService = accessory.getService(hap.Service.Switch);
        switchService.getCharacteristic(hap.Characteristic.On)
            .on("get", callback => {
                self.stationStatus(station, roomName).then(status => {
                    callback(undefined, status);
                }).catch(error => self.log.warn(error));
            })
            .on("set", (value, callback) => {
                if (value) {
                    self.connectToRoomIfNeeded()
                    .then(x => {
                        if (self.powerStateOn(roomName)) {
                            self.log.debug("Change to new station URI for", station.name);
                            self.setStream(station.streamURL).then(() => {
                                callback();
                                self.log.debug("Changed station URI");
                            });
                        } else {
                            self.log.debug("Turn on device");
                            self.mediaRenderer(roomName)
                                .leaveStandby()
                                .then(x => new Promise(resolve => setTimeout(resolve, 3000, x))) // delay
                                .then((_data) => {
                                    self.log.debug("Change to new station URI for", station.name);
                                    return self.setStream(station.streamURL);
                                })
                                .then(() => {
                                    callback();
                                    self.log.debug("Changed station URI");
                                }).catch(error => self.log.warn(error));
                        }
                    })
                } else {
                    callback();
                }
                
                self.onChangeHandler(station.name, roomName, value);
            });

        this.updateHandlers.push(function(newStationName) {
            if (station.name !== newStationName) {
                switchService.getCharacteristic(hap.Characteristic.On).updateValue(false);
            }
        });
    
        this.accessories.push(accessory);
    },

    setStream: function(uri) {
        return this.virtualMediaRenderer.loadUri(uri, false, false);
    },

    onChangeHandler: function(newStationName, roomName, value) {
        var self = this;

        if (value) {
            this.updateHandlers.forEach(handler => handler(newStationName));
        } else {
            this.connectToRoomIfNeeded().then(() => {
                self.log.debug("Turn off connector");
                self.mediaRenderer(roomName)
                    .enterManualStandby()
                    .catch(error => self.log.warn(error));;
            });
        }
    },

    publishAccessory: function(room, stationName) {
        var uuid = hap.uuid.generate("homebridge:raumfeld-radio:station:" + stationName + ":" + room.$.udn);

        if (this.accessories.filter(accessory => accessory.UUID === uuid).length == 0) {
            var name = stationName + " / " + room.$.name
            var accessory = new Accessory(name, uuid);

            var switchService = new hap.Service.Switch(name);
            accessory.addService(switchService);

            this.configureAccessory(accessory);
    
            accessory.getService(hap.Service.AccessoryInformation)
                .setCharacteristic(hap.Characteristic.Manufacturer, "Teufel")
                .setCharacteristic(hap.Characteristic.Model, "Radio Station");
    
            this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        }
    }

}
