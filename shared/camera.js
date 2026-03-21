/**
 * Tenant Reusable Camera Capture Component
 *
 * Usage:
 *   var cam = new MastCamera({  // (ShirCamera still works as alias)
 *     videoElement: document.getElementById('video'),
 *     onCapture: function(result) { ... },
 *     onError: function(err) { ... }
 *   });
 *   cam.start();
 *   cam.capture();  // triggers onCapture with { blob, base64, dimensions, timestamp, deviceInfo }
 *   cam.stop();
 *
 * Consumers: PoS, Studio, Inventory, Event Packing, Production Docs
 */

(function(global) {
  'use strict';

  var DEFAULT_MAX_DIM = 1600;
  var DEFAULT_JPEG_QUALITY = 0.8;
  var DEFAULT_PREVIEW_QUALITY = 0.85;

  function MastCamera(opts) {
    this.videoElement = opts.videoElement;
    this.onCapture = opts.onCapture || function() {};
    this.onError = opts.onError || function() {};
    this.onReady = opts.onReady || function() {};
    this.maxDim = opts.maxDim || DEFAULT_MAX_DIM;
    this.jpegQuality = opts.jpegQuality || DEFAULT_JPEG_QUALITY;
    this.previewQuality = opts.previewQuality || DEFAULT_PREVIEW_QUALITY;
    this.facingMode = opts.facingMode || 'environment';
    this._stream = null;
    this._capturing = false;
  }

  MastCamera.prototype.start = function() {
    var self = this;
    var constraints = {
      video: {
        facingMode: { ideal: self.facingMode },
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      },
      audio: false
    };

    return navigator.mediaDevices.getUserMedia(constraints)
      .then(function(stream) {
        self._stream = stream;
        self.videoElement.srcObject = stream;
        self.videoElement.play().catch(function() {});
        // Wait for video to be ready
        return new Promise(function(resolve) {
          self.videoElement.onloadedmetadata = function() {
            self.onReady({
              width: self.videoElement.videoWidth,
              height: self.videoElement.videoHeight,
              facingMode: self.facingMode
            });
            resolve();
          };
          // Fallback if already loaded
          if (self.videoElement.videoWidth > 0) {
            self.onReady({
              width: self.videoElement.videoWidth,
              height: self.videoElement.videoHeight,
              facingMode: self.facingMode
            });
            resolve();
          }
        });
      })
      .catch(function(err) {
        self.onError({
          type: err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError' ? 'permission' : 'device',
          message: err.message,
          original: err
        });
        throw err;
      });
  };

  MastCamera.prototype.capture = function() {
    var self = this;
    if (self._capturing) return Promise.reject(new Error('Already capturing'));

    var video = self.videoElement;
    if (!video.videoWidth) {
      return Promise.reject(new Error('Camera not ready'));
    }

    self._capturing = true;

    // Capture frame from video
    var canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);

    return new Promise(function(resolve) {
      canvas.toBlob(function(previewBlob) {
        // Compress for upload
        self._compress(previewBlob).then(function(compressedBlob) {
          // Convert to base64
          var reader = new FileReader();
          reader.onloadend = function() {
            var base64 = reader.result.split(',')[1];
            var result = {
              blob: compressedBlob,
              previewBlob: previewBlob,
              previewUrl: URL.createObjectURL(previewBlob),
              base64: base64,
              dimensions: { width: video.videoWidth, height: video.videoHeight },
              timestamp: new Date().toISOString(),
              deviceInfo: {
                facingMode: self.facingMode,
                streamWidth: video.videoWidth,
                streamHeight: video.videoHeight
              }
            };
            self._capturing = false;
            self.onCapture(result);
            resolve(result);
          };
          reader.readAsDataURL(compressedBlob);
        });
      }, 'image/jpeg', self.previewQuality);
    });
  };

  MastCamera.prototype._compress = function(blob) {
    var self = this;
    return createImageBitmap(blob).then(function(bitmap) {
      var w = bitmap.width, h = bitmap.height;
      if (w > self.maxDim || h > self.maxDim) {
        if (w > h) { h = Math.round(h * self.maxDim / w); w = self.maxDim; }
        else { w = Math.round(w * self.maxDim / h); h = self.maxDim; }
      }
      var canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
      bitmap.close();
      return new Promise(function(resolve) {
        canvas.toBlob(function(b) { resolve(b); }, 'image/jpeg', self.jpegQuality);
      });
    });
  };

  MastCamera.prototype.stop = function() {
    if (this._stream) {
      this._stream.getTracks().forEach(function(t) { t.stop(); });
      this._stream = null;
    }
    if (this.videoElement) {
      this.videoElement.srcObject = null;
    }
  };

  MastCamera.prototype.isActive = function() {
    return !!this._stream;
  };

  // Expose globally
  global.MastCamera = MastCamera;
  // Backward compatibility alias
  global.ShirCamera = MastCamera;

})(window);
