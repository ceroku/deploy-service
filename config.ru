require './grack/app'
require './grack/git_adapter'

config = {
  :root => '/Users/imjching/workspace/tempgrack/repo', # TODO: ENV
  :allow_push => true,
  :allow_pull => true,
  :git_adapter_factory => ->{ Grack::GitAdapter.new }
}

run Grack::App.new(config)
