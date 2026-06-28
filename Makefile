FRONTEND_FILES=\
	node_modules/socialcalc/dist/SocialCalc.js \
	third-party/class-js/lib/Class.js \
	third-party/wikiwyg/lib/Document/Emitter.js \
	third-party/wikiwyg/lib/Document/Emitter/HTML.js \
	third-party/wikiwyg/lib/Document/Parser.js \
	third-party/wikiwyg/lib/Document/Parser/Wikitext.js \
	static/jquery.js \
	static/socialcalc-compat.js \
	static/vex.combined.min.js \
	static/jquery-ui.min.js \
	multi/main.ls \
	multi/foldr.ls \
	multi/styles.css \
	node_modules/socket.io/client-dist/socket.io.min.js \
	scripts/build-frontend.js

LS_FILES=$(wildcard src/*.ls)

JS_FILES=$(LS_FILES:src/%.ls=%.js)

run:
	node app.js --cors $(ETHERCALC_ARGS)

vm: all
	node app.js --vm $(ETHERCALC_ARGS)

expire: all
	node app.js --expire 10 $(ETHERCALC_ARGS)

all: depends $(JS_FILES)

$(JS_FILES): %.js: src/%.ls
	env PATH="$$PATH:./node_modules/livescript/bin" lsc -c -o . $<

manifest ::
	perl -pi -e 's/# [A-Z].*\n/# @{[`date`]}/m' manifest.appcache

static/ethercalc.js static/multi.js static/socket.io.js: $(FRONTEND_FILES)
	npm run build:frontend

depends: app.js static/ethercalc.js static/start.css static/multi.js static/socket.io.js

COFFEE := $(shell command -v coffee 2> /dev/null)
.coffee.js:
ifndef COFFEE
	$(error "coffee is not available please install sass")
endif
	coffee -c $<

SASS := $(shell command -v sass 2> /dev/null)
.sass.css:
ifndef SASS
	$(error "sass is not available please install sass")
endif
	sass -t compressed $< > $@

clean ::
	@-rm $(JS_FILES)

.SUFFIXES: .js .css .sass .ls
.PHONY: run vm expire all clean depends
