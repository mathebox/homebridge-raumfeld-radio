
var RaumkernelLib = require("node-raumkernel");
var path = require("path");

var PLUGIN_NAME = "homebridge-raumfeld-radio";
var PLATFORM_NAME = "RaumfeldRadioPlatform";

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

    this.roomName = undefined;

    this.raumkernel = new RaumkernelLib.Raumkernel();
    this.stations = config["stations"];
    this.accessories = [];

    this.updateHandlers = [];

    var self = this;

    // Initializing Raumfeld kernel
    this.raumkernel.createLogger(1, "log");
    this.raumkernel.settings.raumfeldHost = config["hostIP"];
    this.raumkernel.settings.uriMetaDataTemplateFile = path.resolve(__dirname, "../node_modules/node-raumkernel/lib/setUriMetadata.template");
    this.raumkernel.init();

    log.info("Raumfeld radio platform finished initializing!");

    this.api.on('didFinishLaunching', () => {
        self.raumkernel.on("systemReady", () => {
            self.connectToRoom().then(roomName => {
                self.roomName = roomName;
                self.stations.forEach((station) => {
                    self.publishAccessory(station.name);
                });
            }).catch(error => self.log.warn(error));
        });
    })    
}

RaumfeldRadioPlatform.prototype = {

    connectToRoom: function() {
        var zoneConfiguration = this.raumkernel.managerDisposer.zoneManager.zoneConfiguration;

        if (zoneConfiguration == null) {
            return Promise.reject("No zone config found");
        }

        if (!zoneConfiguration.zoneConfig.$.numRooms) {
            return Promise.reject("No Raumfeld Zones found");
        }

        if (zoneConfiguration.zoneConfig.unassignedRooms !== undefined) {
            var room = zoneConfiguration.zoneConfig.unassignedRooms[0].room[0].$
            this.log.info("Found and use unassigned room:", room.name);
            return this.raumkernel.managerDisposer.zoneManager.connectRoomToZone(room.udn, " ").then(() => {
                return Promise.resolve(room.name);
            });
        } else {
            var room = zoneConfiguration.zoneConfig.zones[0].zone[0].room[0].$;
            this.log.info("Use already assigned room:", room.name);
            return Promise.resolve(room.name);
        }
    },

    get['virtualMediaRenderer']() {
        return this.raumkernel.managerDisposer.deviceManager.getVirtualMediaRenderer(this.roomName);
    },

    get['mediaRenderer']() {
        return this.raumkernel.managerDisposer.deviceManager.getMediaRenderer(this.roomName);
    },

    station: function(name) {
        return this.stations.filter(station => station.name === name)[0];
    },

    powerState: function() {
        var zoneConfiguration = this.raumkernel.managerDisposer.zoneManager.zoneConfiguration;
        return zoneConfiguration.zoneConfig.zones[0].zone[0].room[0].$.powerState;
    },

    stationStatus: function(station) { 
        var self = this;
        var virtualMediaRenderer = this.virtualMediaRenderer;
        return virtualMediaRenderer.getMediaInfo().then(data => {
            var stationStatus = data.CurrentURI == station.streamURL && self.powerState() == "ACTIVE";
            return stationStatus
        });
    },

    configureAccessory: function(accessory) {
        var self = this;

        this.log("Configuring accessory %s", accessory.displayName);

        var station = this.station(accessory.displayName);

        var switchService = accessory.getService(hap.Service.Switch);
        switchService.getCharacteristic(hap.Characteristic.On)
            .on("get", callback => {
                self.stationStatus(station).then(status => {
                    callback(undefined, status);
                }).catch(error => self.log.warn(error));
            })
            .on("set", (value, callback) => {
                if (value) {
                    if (self.powerState() == "ACTIVE") {
                        self.log.info("Change to new station URI for", station.name);
                        self.setStream(station.streamURL).then(() => {
                            callback();
                            self.log.info("Changed station URI");
                        });
                    } else {
                        self.log.info("Turn on connector");
                        this.mediaRenderer.leaveStandby()
                        .then(x => new Promise(resolve => setTimeout(resolve, 3000, x))) // delay
                        .then((_data) => {
                            self.log.info("Change to new station URI for", station.name);
                            return self.setStream(station.streamURL);
                        })
                        .then(() => {
                            callback();
                            self.log.info("Changed station URI");
                        }).catch(error => self.log.warn(error));
                    }
                } else {
                    callback();
                }
                
                self.onChangeHandler(station.name, value);
            });

        this.updateHandlers.push(function(newName) {
            switchService.getCharacteristic(hap.Characteristic.On).updateValue(station.name === newName);
        });
    
        this.accessories.push(accessory);
    },

    setStream: function(uri) {
        return this.virtualMediaRenderer.loadUri(uri, false, false);
    },

    onChangeHandler: function(newName, newValue) {
        if (newValue) {
            this.updateHandlers.forEach(handler => handler(newName));
        } else {
            this.log.info("Turn off connector");
            this.mediaRenderer.enterManualStandby();
        }
    },

    publishAccessory: function(name, onChangeHandler) {
        var uuid = hap.uuid.generate("homebridge:raumfeld-radio:station-switch:" + name);

        if (this.accessories.filter(accessory => accessory.UUID === uuid).length == 0) {
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
