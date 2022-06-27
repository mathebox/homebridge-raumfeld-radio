# homebridge-raumfeld-radio

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
