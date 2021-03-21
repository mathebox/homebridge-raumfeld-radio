# homebridge-raumfeld-radio

### Example configuration

```
{
    ...
    "platforms": [
        {
            "platform" : "RaumfeldRadioPlatform",
            "name" : "Teufel",
            "zoneName": "Living Room",
            "stations": [
                {
                    "name": "RadioEins",
                    "streamURL": "https://radioeins.de/stream"
                },
                {
                    "name": "Fritz",
                    "streamURL": "http://fritz.de/livemp3"
                }
            ]
        }
    ]
}
```