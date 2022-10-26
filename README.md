# homebridge-raumfeld-radio

### Setup

When setting up the plugin for the first time (configuration of accessories), make sure the Raumfeld host is running (and playing any radio station).

### Example configuration

```
{
    ...
    "platforms": [
        {
            "platform" : "RaumfeldRadio",
            "name" : "Teufel",
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
