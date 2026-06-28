(function() {
  var root = typeof window !== "undefined" ? window : globalThis;
  var SocialCalc = root.SocialCalc;

  if (!SocialCalc || !SocialCalc.DoOnResize || !SocialCalc.ResizeTableEditor) return;

  var resizeTableEditor = SocialCalc.ResizeTableEditor;
  var localizeString = SocialCalc.LocalizeString;

  if (localizeString) {
    SocialCalc.LocalizeString = function(str) {
      if (str == null) return "";
      return localizeString.call(this, str);
    };
  }

  function tableEditorReady(editor) {
    return !!(
      editor &&
      editor.toplevel &&
      editor.toplevel.style &&
      editor.griddiv &&
      editor.griddiv.style &&
      editor.verticaltablecontrol &&
      editor.verticaltablecontrol.main &&
      editor.verticaltablecontrol.main.style &&
      editor.horizontaltablecontrol &&
      editor.horizontaltablecontrol.main &&
      editor.horizontaltablecontrol.main.style
    );
  }

  SocialCalc.ResizeTableEditor = function(editor, width, height) {
    if (!tableEditorReady(editor)) return;
    return resizeTableEditor.call(this, editor, width, height);
  };

  SocialCalc.DoOnResize = function(spreadsheet) {
    if (!spreadsheet || !spreadsheet.views || !spreadsheet.SizeSSDiv) return;
    if (!spreadsheet.spreadsheetDiv || !spreadsheet.spreadsheetDiv.style) return;
    if (!spreadsheet.parentNode) return;
    if (!tableEditorReady(spreadsheet.editor)) {
      if (root.setTimeout) {
        root.setTimeout(function() {
          if (tableEditorReady(spreadsheet.editor)) SocialCalc.DoOnResize(spreadsheet);
        }, 50);
      }
      return;
    }

    var needresize = spreadsheet.SizeSSDiv();
    if (!needresize) return;

    var viewHeight = spreadsheet.height - (spreadsheet.nonviewheight || 0);
    var views = spreadsheet.views;

    for (var vname in views) {
      if (!Object.prototype.hasOwnProperty.call(views, vname)) continue;

      var view = views[vname];
      var element = view && view.element;
      if (!element || !element.style) continue;

      element.style.width = spreadsheet.width + "px";
      element.style.height = viewHeight + "px";
    }

    spreadsheet.editor.ResizeTableEditor(spreadsheet.width, viewHeight);
  };
})();
