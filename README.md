
# Resource-Monitor-Web-UI

Have you ever wanted to monitor your Ricoh branded printers on a neat little webpage for easy viewing, well then this project is just for you.

# Live demo example
https://moglestu.com/printstatus/



## Features

- Python backend
- Easy to view frontend website
- Less headaches
- Badly written code
- Very cool

## What you will need

- A FTP or SFTP solution
- A website hosting solution
- A server than can run Python
- All machines need to configured to norwegian for this to work


## What you will need to provide yourself

#### You will need a "credentials.json" that needs to be stored in the same folder as your python backend RicohReader.py is stored, and it needs to look like this.

This will be used for the SFTP or FTP login server solution and to upload your json

```JSON
  {
    "host": "sftp.example.com",
    "port": "22",
    "user": "USERNAME",
    "pass": "PASSWORD",
    "path": "/Path/in/server"
  }
```
#### The printer images you provide HAVE to be .png files and they need to be the exact name of the printer like if the printer is called "CS 3000" the png file for the image needs to be called "CS-3000.png" for example
#### You will also need the right dependencies and python libraries you will find these in the requirements.txt just pip install them all

## Config
To add printers you will need to run the RicohReader.py once and while you have it running in the terminal type in the number 2 and press enter. 

You will get a nice json file to edit and you can just do your edits and press submit and relaunch the python file.

If you press 1 on in this control panel you can change the update interval and if you press 3 you can exit the script


## Authors

- [@mahanbig](https://www.github.com/mahanbig)

