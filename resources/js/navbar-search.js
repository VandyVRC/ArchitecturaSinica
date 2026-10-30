// Navbar search functionality
$(document).ready(function() {
$('#navbar-container').load('/resources/components/navbar.html', function() {
    
    function runNavSearch() {
        const keyword = $.trim($('#keywordNav').val());
        if (!keyword) return;
        const qs = document.getElementById('qs');
        if (qs && /\/search\.html$/.test(window.location.pathname)) {
            // Already on the search page: update the field and search without reloading.
            qs.value = keyword;
            history.replaceState(null, '', '/search.html?fullText=' + encodeURIComponent(keyword));
            qs.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
            window.location.href = '/search.html?fullText=' + encodeURIComponent(keyword);
        }
    }

    // Bind first so a failure in the optional plugins below cannot leave the
    // form to submit natively (which sends ?keyword=, not ?fullText=).
    $('#searchbtn').on('click', function(e) {
        e.preventDefault();
        runNavSearch();
    });
    $('#keywordNav').on('keypress', function(e) {
        if (e.which === 13) {
            e.preventDefault();
            runNavSearch();
        }
    });
    $('#navbar-container form.search-box').on('submit', function(e) {
        e.preventDefault();
        runNavSearch();
    });

    if ($.fn.tooltip) $('[data-toggle="tooltip"]').tooltip({ container: 'body' });

    if ($.fn.keyboard) $('.keyboard').keyboard({
        openOn: null,
        stayOpen: false,
        alwaysOpen: false,
        autoAccept: true,
        usePreview: false,
        initialFocus: true,
        rtl: true,
        layout: 'syriac-phonetic',
        hidden: function(event, keyboard, el) {
            // keyboard.destroy();
        }
    });

    $('.keyboard-select').click(function () {
        var keyboardID = '#' + $(this).data("keyboard-id");
        var kb = $(keyboardID).getkeyboard();
        // Change layout based on link ID
        kb.options.layout = this.id;
        // Open keyboard if layout is different or time from it last closing is < 200 ms
        if (kb.last.layout !== kb.options.layout || (new Date().getTime() - kb.last.eventTime) < 200) {
            kb.reveal();
        }
    });
    
    if ($.fn.dropdown) $('.dropdown-toggle').dropdown();
    
    //$('#navbar-container').html(data);
    
     $('.swap-font').on('click', function () {
        var selectedFont = $(this).data("font-id");
        $('.selectableFont').not('.syr').css('font-family', selectedFont);
        $("*:lang(syr)").css('font-family', selectedFont);
    });
    
    
});
});
