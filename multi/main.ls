require \./styles.css
React = require \react
TabPanel = require \react-basic-tabs
BasePath = \.
Index = \foobar
Index = RegExp.$1 if window.location.pathname is /\/=([^_][^\/]*)/
InitialIndex = 0
InitialIndex = parseInt(RegExp.$1) if window.location.hash is /^#sheet=(\d+)$/
InitialIndex = parseInt(RegExp.$1) if window.location.search is /(?:\?|&)active=(\d+)/
HackFoldr = require(\./foldr).HackFoldr
IsReadOnly = window.location.href is /auth=0/
Suffix = ""
if /\?auth=/.test window.location.search
  IsReadOnly = (/\??auth=0/.test window.location.search)
  Suffix = if IsReadOnly then \/view else \/edit
  BasePath = \.. if BasePath is \.
  window.history.pushState {} '' "./=#Index#Suffix"

{div, iframe, button} = React.DOM

createClass = React.createFactory << React.createClass
App = createClass do
  propTypes: { foldr: React.PropTypes.any.isRequired }
  getDefaultProps: -> activeIndex: InitialIndex
  render: ->
    can-delete = @props.foldr.size! > 1
    div { className: "nav#{ if IsReadOnly then ' readonly' else '' }" },
      Nav {
        rows: @props.foldr.rows
        activeIndex: @get-idx!
        onRename: if IsReadOnly then null else @~on-rename
        @~onChange
      }
      if IsReadOnly then '' else Buttons { can-delete, @~on-add, @~on-rename, @~on-delete, @~on-import }
  get-idx: -> @props.activeIndex <? @props.foldr.lastIndex!
  get-sheet: -> @props.foldr.at(@get-idx!)
  get-import-context: ->
    folderId: Index
    activeIndex: @get-idx!
    rows: [ { row.link, row.title } for row in @props.foldr.rows ]
  componentDidMount: ->
    window.getImportContext = @~get-import-context
    @persist-selection @get-idx!
  componentDidUpdate: ->
    for node in document.getElementsByTagName('iframe')
      renderFrameContent node, @props.foldr.rows
  onChange: ->
    activeIndex = it
    @setProps { activeIndex }
    @persist-selection activeIndex
    setTimeout (-> focusFrame activeIndex), 0ms
  persist-selection: (activeIndex) ->
    hash = '#' + 'sheet=' + activeIndex
    window.history.replaceState {} '' "#{ window.location.pathname }#hash" unless window.location.hash is hash
    window.parent.postMessage { setPath: window.location.pathname + hash }, \*
  on-add: ->
    { foldr } = @props
    prefix = \Sheet
    next-sheet = foldr.size! + 1
    link-prefix = "/#Index"
    if foldr.lastRow!title is /^([_a-zA-Z]+)(\d+)$/
      prefix = RegExp.$1
      next-sheet = parseInt RegExp.$2
    if foldr.lastRow!link is /^(\/[^=]+\.|\/sheet(?=\d))/
      link-prefix = RegExp.$1
    while "#prefix#next-sheet" in foldr.titles! or "#link-prefix#next-sheet" in foldr.links!
      ++next-sheet
    activeIndex = foldr.size!
    foldr.=push { link: "#link-prefix#next-sheet", title: "#prefix#next-sheet" }
    @setProps { foldr, activeIndex }
  on-rename: (idx) ->
    { foldr } = @props
    idx = @get-idx! unless typeof idx is \number
    title = prompt("Rename Sheet", foldr.at(idx).title)
    return if not title? or title.toLowerCase! in [ t.toLowerCase! for t in foldr.titles! ]
    # TODO: Carry over the data if non-empty
    foldr.set-at idx, { title }
    @setProps { foldr }
  on-delete: ->
    { foldr } = @props
    return unless confirm("Really delete?\n#{ @get-sheet!title }")
    foldr.delete-at @get-idx!
    @setProps { foldr }
  on-import: (event) ->
    window.importFiles Array.prototype.slice.call(event.target.files), @get-import-context!

Buttons = createClass do
  open-file-picker: ->
    picker = document.createElement \input
    picker.type = \file
    picker.accept = ".csv,.ods,.xlsx"
    picker.style.display = \none
    picker.onchange = @props.on-import
    document.body.appendChild picker
    picker.click!
  render: ->
    div { className: \buttons },
      button { onClick: @props.on-add }, \Add
      button { onClick: @props.on-rename }, \Rename...
      button { onClick: @props.on-delete, disabled: !@props.can-delete }, \Delete
      button { onClick: @~open-file-picker }, \Import

Nav = createClass do
  onChange: -> @props.onChange it
  on-double-click: (event) ->
    return unless @props.onRename
    item = event.target
    while item? and item.tagName isnt \LI then item = item.parentNode
    return unless item?
    items = item.parentNode.children
    for candidate, idx in items when candidate is item
      event.preventDefault!
      return @props.onRename idx
  render: ->
    TabPanel {
      activeIndex: @props.activeIndex
      @~onChange
      onDoubleClick: @~on-double-click
      tabVerticalPosition: \bottom
    },
      ...for { title, link="/#{ encodeURIComponent title }" } in @props.rows
        div { key: title, title, className: \wrapper },
          Frame { src: "#BasePath#link#Suffix", rows: @props.rows }

Frame = createClass do
  shouldComponentUpdate: -> @props.src isnt it.src
  render: -> iframe { key: @props.src, src: @props.src }
  componentDidMount: -> renderFrameContent @getDOMNode!, @props.rows
  componentDidUpdate: -> renderFrameContent @getDOMNode!, @props.rows

isFirstTime = yes
focusFrame = (idx) ->
  node = document.getElementsByTagName('iframe')[idx]
  node?contentWindow?focus!

renderFrameContent = (node, rows) ->
  doc = node.contentDocument
  return unless doc?
  return setTimeout((-> renderFrameContent node, rows), 1ms) unless doc.readyState is \complete
  <~ setTimeout _, 100ms
  node.contentWindow.postMessage JSON.stringify({
    type: "multi"
    rows: rows
    index: Index
  },,2), \*
  if isFirstTime and node is document.getElementsByTagName('iframe')[0]
    focusFrame 0
    isFirstTime := no

<-(window.init=)
foldr = new HackFoldr BasePath
<-foldr.fetch Index
React.render App({ foldr }), document.body
