if (window.SocialCalc && !window.SocialCalc.EtherCalcSizeSSDivUsesParentWidth) {
    (function() {
        var originalSizeSSDiv = window.SocialCalc.SizeSSDiv;

        if (!originalSizeSSDiv) {
            return;
        }

        var getViewportClientSize = function() {
            var size = {};
            if (document.documentElement && document.documentElement.clientWidth) {
                size.width = document.documentElement.clientWidth;
                size.height = document.documentElement.clientHeight;
                return size;
            }
            if (document.body && document.body.clientWidth) {
                size.width = document.body.clientWidth;
                size.height = document.body.clientHeight;
                return size;
            }
            return {
                width: window.innerWidth || 0,
                height: window.innerHeight || 0
            };
        };

        window.SocialCalc.SizeSSDiv = function(spreadsheet) {
            if (!spreadsheet || !spreadsheet.parentNode) {
                return false;
            }

            var resized = originalSizeSSDiv(spreadsheet);
            var viewportSize = getViewportClientSize();
            var parentRect = spreadsheet.parentNode.getBoundingClientRect ?
                spreadsheet.parentNode.getBoundingClientRect() :
                { left: 0, top: 0 };

            var parentWidth = spreadsheet.parentNode.clientWidth;
            var availableWidth = viewportSize.width ?
                viewportSize.width - Math.max(parentRect.left, 0) :
                parentWidth;
            var spreadsheetWidth = Math.floor(Math.min(parentWidth, availableWidth)) - 1;

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
                viewportSize.height &&
                spreadsheet.height > viewportSize.height - Math.max(parentRect.top, 0)) {
                spreadsheet.height = Math.floor(viewportSize.height - Math.max(parentRect.top, 0));
                spreadsheet.spreadsheetDiv.style.height = spreadsheet.height + 'px';
                resized = true;
            }

            return resized;
        };

        window.SocialCalc.EtherCalcSizeSSDivUsesParentWidth = true;
    })();
}

jQuery(document).ready(function() {
    var attempts = 0;
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

                editToolsToggle.off('click.socialcalcEditTools').on('click.socialcalcEditTools', function() {
                    setEditToolsExpanded(!editTools.hasClass('socialcalc-edittools-expanded'));
                });

                jQuery(window).off('resize.socialcalcEditTools').on('resize.socialcalcEditTools', updateEditToolsOverflow);
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
    };

    applyMakeup();
});
