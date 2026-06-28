/*
CC0 1.0 Universal

To the extent possible under law, 唐鳳 has waived all copyright and
related or neighboring rights to EtherCalc.

This work is published from Taiwan.

<http://creativecommons.org/publicdomain/zero/1.0>
*/

startupStarted = Date.now!
logStartup = (label) ->
  now = Date.now!
  logStartup.last ?= startupStarted
  total = now - startupStarted
  delta = now - logStartup.last
  logStartup.last = now
  console.log "[startup +#total ms / +#delta ms] #label"

logStartup "app.js entered pid=#{process.pid} cwd=#{process.cwd!}"

process.env.ETHERCALC_APP_ROOT ?= process.cwd!

installRequireProfiler = (thresholdMs) ->
  Module = require \module
  originalLoad = Module._load
  Module._load = (request, parent, isMain) ->
    started = Date.now!
    try
      originalLoad.apply this, arguments
    finally
      elapsed = Date.now! - started
      if elapsed >= thresholdMs
        parentId = parent?.id or \<root>
        logStartup "require #{request} took #{elapsed} ms parent=#{parentId}"
  -> Module._load = originalLoad

requireProfilerThreshold = Number(process.env.STARTUP_REQUIRE_THRESHOLD_MS) or 100
restoreRequireProfiler = installRequireProfiler requireProfilerThreshold

includeModules =
  main: -> require \./main
  db: -> require \./db
  sc: -> require \./sc
  emailer: -> require \./emailer
  dotcloud: -> require \./dotcloud
  player: -> require \./player
  'player-broadcast': -> require \./player-broadcast
  'player-graph': -> require \./player-graph

installStaticIncludes = (context) ->
  originalInclude = context.include
  context.include = (name) ->
    module = includeModules[name]?!
    if module?
      return module.include.apply context
    originalInclude.call context, name

sendWithStatus = (res, method, args) ->
  if args.length > 1 and typeof args.0 is \number
    res.status(args.0)[method] args.1
  else
    res[method].apply res, args

makeResponse = (res) ->
  type: -> res.type.apply res, arguments
  send: -> sendWithStatus res, \send, arguments
  json: -> sendWithStatus res, \json, arguments
  sendfile: -> res.sendFile.apply res, arguments
  redirect: -> res.redirect.apply res, arguments
  set: -> res.set.apply res, arguments
  header: -> res.header.apply res, arguments
  location: -> res.location.apply res, arguments

makeSocketContext = (context, socket, data) ->
  emit = ->
    if arguments.length is 1 and arguments.0?data?
      socket.emit \data, arguments.0.data
    else
      socket.emit.apply socket, arguments
  {
    app: context.app
    express: context.express
    io: context.io
    socket
    data
    emit
  }

makeRequestContext = (context, req, res) ->
  {
    app: context.app
    express: context.express
    io: context.io
    request: req
    req
    query: req.query
    params: req.params
    body: req.body
    response: makeResponse res
    res
  }

registerRoute = (context, method, path, handler) ->
  wrapped = (req, res, next) ->
    ctx = makeRequestContext context, req, res
    try
      handler.call ctx, req, res, next
    catch e
      next e
  routePath = if path is // \*$ // then new RegExp("^#{path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*$/, '.*')}$") else path
  context.app[method] routePath, wrapped

clientScript = (fn) -> """
(function(fn) {
  var socket = null;
  var ctx = {
    connect: function(namespace, options) {
      socket = window.io(namespace || '/', options || {});
      ctx.socket = socket;
      return { io: socket };
    },
    emit: function(packet, data) {
      if (!socket) return;
      if (arguments.length === 1 && packet && Object.prototype.hasOwnProperty.call(packet, 'data')) {
        return socket.emit('data', packet.data);
      }
      return socket.emit(packet, data);
    },
    on: function(handlers) {
      Object.keys(handlers || {}).forEach(function(event) {
        socket.on(event, function(data) {
          return handlers[event].call({
            data: data,
            socket: socket,
            io: socket,
            emit: ctx.emit.bind(ctx)
          });
        });
      });
    }
  };
  return fn.call(ctx);
})(#{fn});
"""

registerClientRoute = (context, path, fn) ->
  registerRoute context, \get, path, ->
    @response.type \application/javascript
    @response.send clientScript fn

registerSocketHandler = (context, socket, event, handler) ->
  socket.on event, (data) ->
    handler.call makeSocketContext(context, socket, data)

makeContext = (app, server, io, express) ->
  socketHandlers = {}
  context =
    app: app
    server: server
    io: io
    express: express
    settings: app.settings
    locals: app.locals
    include: (name) ->
      module = includeModules[name]?!
      return module.include.apply context if module?
      throw new Error "Unknown include: #{name}"
    use: ->
      for arg in arguments
        continue if typeof arg is \string
        continue unless typeof arg is \function
        app.use arg
    client: (routes) ->
      for path, fn of routes
        registerClientRoute context, path, fn
    on: (handlers) ->
      for event, handler of handlers
        socketHandlers[event] = handler
    get: (routes, handler) ->
      if typeof routes is \string
        registerRoute context, \get, routes, handler
      else
        for path, fn of routes
          registerRoute context, \get, path, fn
    post: (routes, handler) ->
      if typeof routes is \string
        registerRoute context, \post, routes, handler
      else
        for path, fn of routes
          registerRoute context, \post, path, fn
    put: (routes, handler) ->
      if typeof routes is \string
        registerRoute context, \put, routes, handler
      else
        for path, fn of routes
          registerRoute context, \put, path, fn
    delete: (routes, handler) ->
      if typeof routes is \string
        registerRoute context, \delete, routes, handler
      else
        for path, fn of routes
          registerRoute context, \delete, path, fn
    all: (routes, handler) ->
      if typeof routes is \string
        registerRoute context, \all, routes, handler
      else
        for path, fn of routes
          registerRoute context, \all, path, fn
  io.configure = (fn) -> fn?!
  io.set = ->
  io.enable = ->
  io.on \connection, (socket) ->
    joinedRooms = socket.data.joinedRooms = []
    originalJoin = socket.join.bind socket
    socket.join = (room) ->
      joinedRooms.push room unless room in joinedRooms
      originalJoin room
    for event, handler of socketHandlers when event isnt \disconnect
      registerSocketHandler context, socket, event, handler
    if socketHandlers.disconnect
      socket.on \disconnect, ->
        socketHandlers.disconnect.call makeSocketContext(context, socket)
  context

slurp = -> require \fs .readFileSync it, \utf8
argv = (try require \optimist .boolean <[ vm polling cors ]> .argv) || {}
logStartup "parsed command-line arguments"
json = try JSON.parse slurp \/home/dotcloud/environment.json
logStartup "checked /home/dotcloud/environment.json"
port = Number(argv.port or json?PORT_NODEJS or process.env.PORT or process.env.VCAP_APP_PORT or process.env.OPENSHIFT_NODEJS_PORT) or 8000
host = argv.host or process.env.VCAP_APP_HOST or process.env.OPENSHIFT_NODEJS_IP or \0.0.0.0
basepath = (argv.basepath or "") - //  /$  //

{ keyfile, certfile, key, polling, cors, expire } = argv

transport = \http
if keyfile? and certfile?
  options = https:
    key: slurp keyfile
    cert: slurp certfile
  transport = \https
else options = {}

console.log "Please connect to: #transport://#{
  if host is \0.0.0.0 then require \os .hostname! else host
}:#port/"

logStartup "loading express and socket.io"
express = require \express
http = require \http
socketio = require \socket.io
logStartup "loaded express and socket.io"
app = express!
app.use express.json limit: \50mb
server = if options.https then require \https .createServer options.https, app else http.createServer app
io = new socketio.Server server, cors: if cors then origin: \* else void
context = makeContext app, server, io, express
context.KEY = key
context.BASEPATH = basepath
context.POLLING = polling
context.CORS = cors
context.EXPIRE = +expire
context.EXPIRE = 0 if isNaN context.EXPIRE
logStartup "including main"
includeResult = context.include \main
logStartup "included main"
restoreRequireProfiler!
server.listen port, host, -> console.log "Express server listening on port #port"
logStartup "server listen requested"
includeResult
