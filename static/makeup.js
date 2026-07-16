if (window.SocialCalc && !window.SocialCalc.EtherCalcUsesFlexResize) {
    (function() {
        var SocialCalc = window.SocialCalc;
        var originalSizeSSDiv = window.SocialCalc.SizeSSDiv;
        var originalSetTab = window.SocialCalc.SetTab;

        if (!originalSizeSSDiv) {
            return;
        }

        var addClass = function(element, className) {
            if (element && element.classList) {
                element.classList.add(className);
            }
        };

        var getViewportClientSize = function() {
            var root = document.documentElement || {};
            var body = document.body || {};

            return {
                width: root.clientWidth || body.clientWidth || window.innerWidth || 0,
                height: root.clientHeight || body.clientHeight || window.innerHeight || 0
            };
        };

        var tableEditorReady = function(editor) {
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
        };

        var getParentSize = function(spreadsheet) {
            var parent = spreadsheet.parentNode;
            var viewportSize = getViewportClientSize();
            var rect = parent.getBoundingClientRect ?
                parent.getBoundingClientRect() :
                { left: 0, top: 0 };

            return {
                width: parent.clientWidth ||
                    Math.max(0, viewportSize.width - Math.max(rect.left, 0)),
                height: parent.clientHeight ||
                    Math.max(0, viewportSize.height - Math.max(rect.top, 0))
            };
        };

        var ensureViewSlot = function(spreadsheet) {
            if (!spreadsheet.spreadsheetDiv || !spreadsheet.editorDiv) {
                return null;
            }

            var viewSlot = spreadsheet.ethercalcViewSlot;
            if (!viewSlot || viewSlot.parentNode !== spreadsheet.spreadsheetDiv) {
                viewSlot = document.createElement('div');
                viewSlot.className = 'socialcalc-view-slot';
                spreadsheet.spreadsheetDiv.insertBefore(viewSlot, spreadsheet.editorDiv);
                spreadsheet.ethercalcViewSlot = viewSlot;
            }

            var addView = function(element) {
                if (!element) {
                    return;
                }
                addClass(element, 'socialcalc-main-view');
                if (element.parentNode !== viewSlot) {
                    viewSlot.appendChild(element);
                }
            };

            addView(spreadsheet.editorDiv);

            var views = spreadsheet.views || {};
            for (var vname in views) {
                if (!Object.prototype.hasOwnProperty.call(views, vname)) {
                    continue;
                }
                addView(views[vname] && views[vname].element);
            }

            return viewSlot;
        };

        var applyFlexLayout = function(spreadsheet) {
            addClass(spreadsheet.spreadsheetDiv, 'socialcalc-spreadsheet-shell');
            return ensureViewSlot(spreadsheet);
        };

        var getElementHeight = function(element) {
            if (!element) {
                return 0;
            }
            var rect = element.getBoundingClientRect ?
                element.getBoundingClientRect() :
                null;

            return Math.floor(
                (rect && rect.height) ||
                element.clientHeight ||
                0
            );
        };

        window.SocialCalc.SizeSSDiv = function(spreadsheet) {
            if (!spreadsheet || !spreadsheet.parentNode) {
                return false;
            }

            var resized = originalSizeSSDiv(spreadsheet);
            var parentSize = getParentSize(spreadsheet);
            var spreadsheetWidth = Math.floor(parentSize.width);
            var spreadsheetHeight = Math.floor(parentSize.height);

            applyFlexLayout(spreadsheet);

            if (!spreadsheet.requestedWidth &&
                spreadsheet.spreadsheetDiv &&
                spreadsheetWidth > 0 &&
                spreadsheet.width !== spreadsheetWidth) {
                spreadsheet.width = spreadsheetWidth;
                spreadsheet.spreadsheetDiv.style.width = spreadsheetWidth + 'px';
                resized = true;
            }

            if (!spreadsheet.requestedHeight &&
                spreadsheet.spreadsheetDiv &&
                spreadsheetHeight > 0 &&
                spreadsheet.height !== spreadsheetHeight) {
                spreadsheet.height = spreadsheetHeight;
                spreadsheet.spreadsheetDiv.style.height = spreadsheetHeight + 'px';
                resized = true;
            }

            return resized;
        };

        window.SocialCalc.DoOnResize = function(spreadsheet) {
            if (!spreadsheet || !spreadsheet.views || !spreadsheet.SizeSSDiv) {
                return;
            }
            if (!spreadsheet.spreadsheetDiv || !spreadsheet.spreadsheetDiv.style) {
                return;
            }
            if (!spreadsheet.parentNode) {
                return;
            }
            if (!tableEditorReady(spreadsheet.editor)) {
                if (window.setTimeout) {
                    window.setTimeout(function() {
                        if (tableEditorReady(spreadsheet.editor)) {
                            SocialCalc.DoOnResize(spreadsheet);
                        }
                    }, 50);
                }
                return;
            }

            spreadsheet.SizeSSDiv();
            var viewSlot = applyFlexLayout(spreadsheet);

            var viewWidth = spreadsheet.width;
            var viewHeight = getElementHeight(viewSlot) ||
                spreadsheet.height - (spreadsheet.nonviewheight || 0);
            var views = spreadsheet.views;

            for (var vname in views) {
                if (!Object.prototype.hasOwnProperty.call(views, vname)) {
                    continue;
                }

                var view = views[vname];
                var element = view && view.element;
                if (!element || !element.style) {
                    continue;
                }

                element.style.width = viewWidth + 'px';
                element.style.height = viewHeight + 'px';
            }

            spreadsheet.editor.ResizeTableEditor(viewWidth, viewHeight);
        };

        if (originalSetTab) {
            window.SocialCalc.SetTab = function() {
                var result = originalSetTab.apply(this, arguments);
                var spreadsheet = SocialCalc.GetSpreadsheetControlObject &&
                    SocialCalc.GetSpreadsheetControlObject();
                if (spreadsheet && window.setTimeout) {
                    window.setTimeout(function() {
                        SocialCalc.DoOnResize(spreadsheet);
                    }, 0);
                }
                return result;
            };
        }

        window.SocialCalc.EtherCalcUsesFlexResize = true;
    })();
}

jQuery(document).ready(function() {
    var attempts = 0;
    var resizeSpreadsheet = function() {
        var spreadsheet = window.spreadsheet ||
            (window.SocialCalc &&
                window.SocialCalc.GetSpreadsheetControlObject &&
                window.SocialCalc.GetSpreadsheetControlObject());

        if (spreadsheet && spreadsheet.DoOnResize) {
            spreadsheet.DoOnResize();
        }
    };
    var applyMakeup = function() {
        if (!jQuery('#SocialCalc-edittools').length) {
            if (attempts < 50) {
                attempts += 1;
                setTimeout(applyMakeup, 50);
            }
            return;
        }

        jQuery('#SocialCalc-edittools img[id]').addClass('btn btn-link btn-xs');

        var editTools = jQuery('#SocialCalc-edittools');
        if (editTools.length) {
            var editToolsShell = editTools.parent().addClass('socialcalc-edittools-shell');
            var editToolsToggle = editTools.next('.socialcalc-edittools-toggle');

            if (!editToolsToggle.length) {
                editToolsToggle = jQuery('<button type="button" class="socialcalc-edittools-toggle" aria-label="Show more toolbar buttons" aria-expanded="false" title="Show more toolbar buttons">&#9662;</button>');
                editTools.after(editToolsToggle);
            }

            var setEditToolsExpanded = function(expanded) {
                editTools.toggleClass('socialcalc-edittools-expanded', expanded);
                editToolsShell.toggleClass('socialcalc-edittools-expanded-shell', expanded);
                editToolsToggle
                    .attr('aria-expanded', expanded ? 'true' : 'false')
                    .attr('aria-label', expanded ? 'Show fewer toolbar buttons' : 'Show more toolbar buttons')
                    .attr('title', expanded ? 'Show fewer toolbar buttons' : 'Show more toolbar buttons')
                    .html(expanded ? '&#9652;' : '&#9662;');
            };

            var updateEditToolsOverflow = function() {
                var toggleWidth = editToolsToggle.is(':visible') ? editToolsToggle.outerWidth(true) : 0;
                var contentWidth = 0;
                var toolbarWidth = editTools[0].clientWidth + toggleWidth;

                editTools.children().each(function() {
                    contentWidth += jQuery(this).outerWidth(true);
                });

                var hasOverflow = contentWidth > toolbarWidth + 1;
                editToolsShell.toggleClass('socialcalc-edittools-has-overflow', hasOverflow);

                if (!hasOverflow) {
                    setEditToolsExpanded(false);
                }
            };

            var updateEditToolsActive = function() {
                editToolsShell.toggleClass('socialcalc-edittools-active', editTools.is(':visible'));
            };

            if (window.SocialCalc && SocialCalc.SetTab && !SocialCalc.EtherCalcTracksEditToolsTab) {
                var setTab = SocialCalc.SetTab;
                SocialCalc.SetTab = function() {
                    var result = setTab.apply(this, arguments);
                    updateEditToolsActive();
                    setTimeout(updateEditToolsOverflow, 0);
                    return result;
                };
                SocialCalc.EtherCalcTracksEditToolsTab = true;
            }

            editToolsToggle.off('click.socialcalcEditTools').on('click.socialcalcEditTools', function() {
                setEditToolsExpanded(!editTools.hasClass('socialcalc-edittools-expanded'));
            });

            jQuery(window).off('resize.socialcalcEditTools').on('resize.socialcalcEditTools', updateEditToolsOverflow);
            updateEditToolsActive();
            setTimeout(updateEditToolsOverflow, 0);
        }

        jQuery('#SocialCalc-cellsettingstoolbar input[type!="checkbox"],'+
               '#SocialCalc-settingsview input[type!="checkbox"],'+
               '#SocialCalc-sorttools input[type!="checkbox"], #SocialCalc-sorttools select,'+
               '#SocialCalc-commenttools input,'+
               '#SocialCalc-namestools input[type!="checkbox"], #SocialCalc-namestools select,'+
               '#SocialCalc-clipboardview input,'+
               '#SocialCalc-graphtools input, #SocialCalc-graphtools select')
            .addClass('btn btn-default btn-xs');

        jQuery('#SocialCalc-commenttools textarea, #SocialCalc-clipboardview textarea').addClass('form-control');

        jQuery('#SocialCalc-formulafunctions').prev()
            .addClass('form-control input-sm')
            .parent().addClass('socialcalc-formula-bar');
        jQuery('#searchbarinput').addClass('form-control input-sm');

        jQuery('#SocialCalc-settings-savecell, #SocialCalc-settings-savesheet, input[value="OK"], input[value="Live Form"]')
            .addClass('btn-primary btn btn-xs')
            .removeClass('btn-default');

        jQuery(window).trigger('resize');
        setTimeout(resizeSpreadsheet, 0);
        setTimeout(resizeSpreadsheet, 50);
    };

    applyMakeup();
});
