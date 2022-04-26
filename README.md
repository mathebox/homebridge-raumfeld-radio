# homebridge-raumfeld-radio

### Example configuration

```
{
    ...
    "platforms": [
        {
            "platform" : "RaumfeldRadio",
            "name" : "Teufel",
            "hostIP": "0.0.0.0",
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
