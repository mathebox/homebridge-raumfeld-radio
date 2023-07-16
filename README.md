# homebridge-raumfeld-radio

## Setup

When setting up the plugin for the first time (configuration of accessories), make sure all Raumfeld devices are running (and optionally playing any radio station).

### Example configuration

```
{
    ...
    "platforms": [
        {
            "platform" : "RaumfeldRadio",
            "hostIP": "0.0.0.0", // optional
            "stations": [
                {
                    "name": "RadioEins",
                    "streamURL": "https://radioeins.de/stream",
                    "ebrowseID": "s25111" // optional
                },
                {
                    "name": "Fritz",
                    "streamURL": "http://fritz.de/livemp3",
                    "ebrowseID": "s25005", // optional
                    "excludedRooms": [ // optional
                        "Living room"
                    ]
                }
            ]
        }
    ]
}
```

## Implementation details

### Raumfeld specfic

- The configuration can consist of multiple zones.
- Each zone can have multiple subzones.
- The playback is started on a subzone with a virtual renderer.
- Each subzone can have multiple rooms.
- In each room multiple renders can be located (actual devices).

### Plugin specific

- An accessory is created for each room. The individual renderers in this room are added as a service.
