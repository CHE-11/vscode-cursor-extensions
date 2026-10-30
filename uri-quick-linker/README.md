# URI Quick Linker
URI Quick Linker is a fast way to copy, paste, and jump to URI links in your project. This makes it easy to make a way to link to a specific page in your project from a different page.

https://github.com/CHE-11/uri-quick-linker/assets/57516026/c086b7c7-dbc0-40bc-be0e-68a306ec9416

View Demo Video @ [https://github.com/CHE-11/uri-quick-linker/assets/57516026/c086b7c7-dbc0-40bc-be0e-68a306ec9416](https://github.com/CHE-11/uri-quick-linker/assets/57516026/c086b7c7-dbc0-40bc-be0e-68a306ec9416) if you cannot see the video above. 


## Usage
The extension gives you three options on the right click context menu: 
- Copy URI and Line Number
- Paste Commented URI
- Format URI's


There is another option in the command palette:
- Format Commented URI's - Sometimes the extension glitches and doesn't turn the URI into a link. This option will format the URI into a link.


## Config
There are three settings that can be changed: 
- uriQuickLinker.useVSCodeInsiders : boolean - Set to true if you use a vscode insider build
- uriQuickLinker.includeColumn : boolean - Set to true if you want to include the column number in the URI
- uriQuickLinker.fileTypes : object - Set different prefix and suffixs for different file types
- uriQuickLinker.linkColor : string - Format should included the # if you want to use a hex color. 
- uriQuickLinker.showLinkIcon : boolean - Set to true if you want to show a link icon next to the URI


## Development
To work on the extension, simple clone the repo, and run ```yarn install``` to install the dependencies. Then run the VS Code command ```Start Debugging``` to start the extension in a new window.


## Packaging
If you don't have vsce install already, run ```npm install -g vsce``` to install it. 
Then run ```vsce package``` to create a .vsix file. You can then install this file in VS Code by running the command ```Extensions: Install from VSIX...``` in the command palette or right clicking on the file in vscode and selecting ```Install Extension VSIX```.


## Limitations
The links don't change their references when the referenced file is moved, edited, renamed, or deleted. This is a limitation of the extension. Maybe at some point I would like to make it watch for changes and update the links accordingly. 

The links are also absolute, so for distributed projects, the links will not work. For me, this works just fine as I setup all projects to use the exact same paths across my 4 computers. But it would be nice to have a way to make the links relative for others to use. 

But for now, it is what it is.


## Acknowlegements
My extension is heavily based off [Elliot Betancourt's Extension - hipdot-vs-code-url-scheme-grabber](https://github.com/ebetancourt/hipdot-vs-code-url-scheme-grabber/tree/main?tab=readme-ov-file) which is heavily based off the hardwork of [Nisanth Chunduru's Extension - vscode-copy-filepath-with-line-number](https://github.com/nisanthchunduru/vscode-copy-filepath-with-line-number).

Big thanks to both!

