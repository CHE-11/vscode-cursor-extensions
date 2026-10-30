# Endpointer
Endpointer is a fast way to jump from an endpoint call in the frontend to the route in the backend in a monorepo.

If you work in a monorepo like I tend to do, you know how annoying it can be to have to jump between the frontend and backend to find the route that is being called. You end up going to an index file that lists all the routes, then you have to find the route that is being called. It's a pain. 

https://github.com/CHE-11/endpointer/assets/57516026/ad8bec06-10b8-418c-9d39-135d24d3143b

## Usage
There are two options in the command palette:
- Paste Endpoint Template ➜ This pastes an endpoint template that you can fill in with the endpoint and method. 
- Refresh Endpointer ➜ Will reindex workspace and refresh the sidebar.

The extension gives you one option on the right click context menu: 
- Paste Endpoint Template ➜ This pastes an endpoint template that you can fill in with the endpoint and method. 

## Config
There are many settings that can be changed: 
- endpointer.excludeFromIndex ➜ This is an array of glob patterns that will be excluded from the index. 
  - Default is ```["**/node_modules/**", "**/dist/**", "**/build/**", "**/public/**", "**/coverage/**", "**/test/**", "**/tests/**", "**/tmp/**", "**/temp/**", "**/vendor/**", "**/assets/**", "**/lib/**", "**/static/**", "**/out/**", "**/output/**", "**/logs/**", "**/log/**", "**/backup/**", "**/backups/**", "**/cache/**"]```
- endpointer.includeInIndex ➜ This is an array of glob patterns that will be included in the index. 
  - Default is ```"{**/*.js, **/*.ts, **/*.tsx, **/*.jsx, **/*.py}"```
- endpointer.useVSCodeInsiders ➜ This is a boolean that determines if the extension uses the VS Code Insiders API.
  - Default is ```false```
- endpointer.endpointTemplateFormat - This is the format that is used to get the details about the endpoint on the backend. 
  - Default is ```// ENDPOINTER <> "method": "GET", "endpoint": "/api/endpoint" ```
- endpoint.endpointRegex ➜ This is the regex that is used to find the endpoint in the backend. 
  - Default is ```\/\/ ENDPOINTER <> \"(method)\": \"(GET|POST|PUT|DELETE)\", \"endpoint\": \"(.+)\"```
- endpointer.frontendCallRegex ➜ This is the regex that is used to find the endpoint call in the frontend. 
  - Default is ```/fetch\((?:'|")(.+)(?:'|")\)/```
- endpointer.linkColor ➜ This is the color that the link will be in the endpoint template. 
  - Default is ```#0000FF```
  - This can be any valid css color.
- endpointer.showLinkIcon ➜ This is a boolean that determines if the link icon is shown in the endpoint template. 
  - Default is ```true```


## Development
To work on the extension, simple clone the repo, and run ```yarn install``` to install the dependencies. Then run the VS Code command ```Start Debugging``` to start the extension in a new window.


## Packaging
If you don't have vsce install already, run ```npm install -g vsce``` to install it. 
Then run ```vsce package``` to create a .vsix file. You can then install this file in VS Code by running the command ```Extensions: Install from VSIX...``` in the command palette or right clicking on the file in vscode and selecting ```Install Extension VSIX```.

## Limitations
Right now, the tree view listing the endpoints doesn't work well. I will work on it in the future, but I don't have a great need for it and I really don't have much time at the moment. 

## Acknowlegements


